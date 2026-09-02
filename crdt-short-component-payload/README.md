# A component payload too short for its schema aborts the whole tick

Reproduction scene for [js-sdk-toolchain#1597](https://github.com/decentraland/js-sdk-toolchain/pull/1597) —
_fix(ecs): drop a component update whose payload the schema cannot read_.

A CRDT `PUT_COMPONENT` (or `APPEND_VALUE`) carries a component's serialized value as its payload. The
frame around it can be perfectly well-formed — header, fields and the announced data length all agree —
while the payload itself is shorter than the component's schema needs. The message reads fine; the
**deserialize** the engine runs afterwards walks off the end of the buffer and throws
`Outside of the bounds of writen data.` straight out of `engine.update`.

Because that happens inside `crdtSceneSystem.receiveMessages`, which runs at the very start of every
`engine.update`, one such message aborts the entire tick: every other message in the same batch is lost,
and the runtime driving the scene sees its update reject.

## The bug

`receiveMessages` in `packages/@dcl/ecs/src/systems/crdt/index.ts` dispatched each message to its
component with no guard:

```ts
const [conflictMessage, value] = component.updateFromCrdt({ ...msg, entityId })
```

and the last-write-wins component deserialized straight into its state:

```ts
timestamps.set(entity, msg.timestamp)
if (msg.type === CrdtMessageType.PUT_COMPONENT || msg.type === CrdtMessageType.PUT_COMPONENT_NETWORK) {
  const buf = new ReadWriteByteBuffer(msg.data!)
  data.set(entity, schema.deserialize(buf))   // <- throws on a short payload
  ...
```

`schema.deserialize` reads each field with `ByteBuffer`, which throws the moment a read runs past the
written bytes. Note the timestamp was already advanced one line above, so even catching the throw
higher up would leave the component in a half-updated state.

## Who hits it

The chunk arrives straight from a transport's `onmessage`. In `@dcl/sdk` the peer path is the sync
transport that `@dcl/sdk/network` installs, so the bytes come from **another player in the room**. A peer
on a different SDK version whose schema for a shared component has changed, or one that simply truncates
a write, takes down the tick for everyone who receives it. This is the payload-level sibling of the
framing bug fixed in [#1567](https://github.com/decentraland/js-sdk-toolchain/pull/1567): that one guards
the message envelope, this one guards the value inside it.

## The fix

Two small changes, so a malformed payload is dropped and the tick keeps running:

- The last-write-wins component deserializes into a local before mutating anything, so a throw leaves its
  timestamp and data untouched. (The grow-only component already deserializes before it appends.)
- `receiveMessages` wraps `updateFromCrdt` in `try/catch`; on a throw it drops just that message —
  no broadcast to other transports, no change notification — and continues with the rest of the batch.

## What the scene does

`src/index.ts` gives a private `Engine()` its own Transform and a transport, then on a countdown hands it
one chunk holding two messages:

1. A **malformed** `PUT_COMPONENT` for the Transform of one entity, with a 4-byte payload (Transform needs
   40+).
2. A **well-formed** Transform `PUT` for a second entity, right behind it in the same chunk.

It then calls `engine.update` and reports:

- On a released SDK, `update` rejects while deserializing the short payload. The sign turns red:
  `BUG REPRODUCED`, and the well-formed message behind it never applied.
- On a fixed SDK, `update` resolves, the malformed entity has no Transform, the healthy one does, and the
  sign turns green: `FIXED`.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White while it counts down, then red if the tick aborts, green if the
malformed message is dropped and the healthy one still lands.

## Measured results

Headless, driving the same path the scene drives (`addTransport`, `onmessage`, `engine.update`), against
`@dcl/sdk@7.26.0` and then against the same artifact with the fix's
`lww-element-set-component-definition.js` and `systems/crdt/index.js` dropped into `@dcl/ecs/dist`:

| | `@dcl/sdk@7.26.0` | with the fix |
| --- | --- | --- |
| `engine.update` | **throws** `Outside of the bounds of writen data.` | resolves |
| malformed entity gets a Transform | tick aborted | no |
| well-formed message behind it applies | tick aborted | yes |

## Re-testing against the fix

Each CI build of a branch publishes a version tagged with its commit:

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for the PR head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

Once the fix lands on `main`:

```bash
npm run upgrade-sdk:next          # npm install --save-dev @dcl/sdk@next
```

## Notes

The fix guards against any deserialize failure, not only a short buffer — an enum out of range, a nested
length that overruns, and the like all get the same treatment: drop the one message, keep the tick alive.
A dropped message advances nothing, so a later well-formed update for the same entity at the same lamport
timestamp is still a first write and still wins.

`Transform` at the `@dcl/ecs` package root is bound to the default engine; the private probe needs one
bound to its own engine, so it imports the raw factory from `@dcl/ecs/dist/components`. The message
writers and the `Transport` type are not re-exported from `@dcl/sdk/ecs` either, which is why `@dcl/ecs`
is pinned alongside `@dcl/sdk` in `package.json`.
