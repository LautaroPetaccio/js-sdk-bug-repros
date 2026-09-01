# a trigger area replaying its history when a handler is swapped

Reproduction scene for [js-sdk-toolchain#1584](https://github.com/decentraland/js-sdk-toolchain/pull/1584) —
_fix(ecs): stop trigger areas replaying their history on re-subscribe_.

Swap a trigger handler for a different one and the new handler is immediately fired for events the old
one already dealt with: an entry for a player who walked through and left long ago.

## The bug

`packages/@dcl/ecs/src/systems/triggerArea.ts`, when the last callback for an entity is removed:

```ts
// Remove entity if no more trigger callbacks are registered.
// insideTriggerers is intentionally left populated so that re-subscription picks up
// in-flight sessions without missing the first synthesized onStay.
if (triggerCallbackMap.size === 0) entitiesMap.delete(entity)
```

That entry holds more than the callbacks. It holds `lastConsumedTimestamp`, the cursor marking how far
the entity's event history has been consumed, and `insideTriggerers`. Deleting it rebuilds both from
scratch on the next registration with the cursor back at `-1`, so the next callback is replayed the whole
history.

The comment says `insideTriggerers` is deliberately kept. The line under it throws it away.

## Who hits it

Swapping a handler, which is ordinary:

```ts
triggerAreaEventsSystem.removeOnTriggerEnter(area)
triggerAreaEventsSystem.onTriggerEnter(area, newHandler)
```

Whatever the handler does on entry, spawning something, granting something, counting something, happens
again for a player who is not there. The longer the scene has been running the more history there is to
replay.

## What the scene does

`src/index.ts` sends an area a full pass: a player enters, then exits, while the first pair of handlers
is listening. It then swaps in a new enter handler and counts how many times it fires before anything new
happens, which should be zero. Finally it sends one genuine entry and checks that the new handler does
receive that, so the fix cannot be "stop delivering anything".

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the new handler fires for old events, green when it starts from now.

## Measured results

Headless, the same sequence against `@dcl/sdk@7.26.0` and then against the same artifact with #1584
applied to `@dcl/ecs/dist/systems/triggerArea.js`:

| | fired for already-consumed events | fired for the entry after the swap |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **1** | 1 |
| with the fix | 0 | 1 |

Two events were replayed in the fixture and only the enter is counted, because the replacement handler
only listens for entries. A handler listening for both would see the exit too.

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

This scene drives the scene's own engine rather than a private one, because the system factory is
internal: only the ready-made `triggerAreaEventsSystem` is exported to scenes.
