# CRDT parser spinning on a zero-length header, or throwing on a truncated known message

Reproduction scene for [js-sdk-toolchain#1567](https://github.com/decentraland/js-sdk-toolchain/pull/1567) —
_fix(ecs): reject CRDT messages shorter than their header_.

A CRDT chunk is a sequence of length-framed messages, and the parser trusts the frame in two ways it
should not:

- A message whose header claims a length of **0** makes the reader advance by zero bytes and read the same
  header again, forever. The scene thread is single-threaded, so the scene is dead — no frames, no input,
  no recovery.
- A message of a type the reader **knows** is read field by field with no check that the frame holds those
  fields. A header-only entity delete, or a component update announcing more data than it carries, makes
  the byte buffer throw straight out of the transport's `onmessage`, and the tick that received the chunk
  aborts.

## The bug

`packages/@dcl/ecs/src/serialization/crdt/crdtMessageProtocol.ts`:

```ts
export function validate(buf: ByteBuffer) {
  const rem = buf.remainingBytes()
  if (rem < CRDT_MESSAGE_HEADER_LENGTH) {
    return false
  }

  const messageLength = buf.getUint32(buf.currentReadOffset())
  if (rem < messageLength) {
    return false
  }

  return true
}
```

The declared length is checked against how many bytes are left, never against the 8-byte header the
protocol documents as its own minimum. `getHeader` reads the header **without consuming it**, so the
skip in `parseChunkMessage` is what has to make progress:

```ts
while ((header = CrdtMessageProtocol.getHeader(buffer))) {
  if (header.type === CrdtMessageType.DELETE_ENTITY) {
    message = DeleteEntity.read(buffer)!
  } else if ...
  } else {
    // consume the message
    buffer.incrementReadOffset(header.length)
  }
}
```

`incrementReadOffset(0)` is a no-op that does not even throw, so for an unknown type the loop never
exits. For a known type the reader takes over, and `DeleteEntity.read` simply calls `readUint32()` for
the entity id: with nothing after the header, the byte buffer throws `Outside of the bounds of writen
data.` through `onmessage` and out of whatever called the transport.

## Who hits it

The chunk arrives straight from a transport's `onmessage`. In `@dcl/sdk` the peer path is the sync
transport that `@dcl/sdk/network` installs, so the bytes come from **another player in the room** and
nothing between comms and the parser checks them. One malformed 8-byte packet freezes, or aborts the
tick of, every participant of that scene who has the transport. Nothing about it requires a hostile peer
either — a client that pads its send buffer with zeros produces exactly a zero-length header, and a
truncated write produces a frame shorter than its type.

## What the scene does

`src/index.ts` gives a private `Engine()` a transport and hands it three chunks by hand:

1. A **control** chunk: unknown type, honest length of 12. The parser skips it and returns, which is the
   behaviour both malformed cases are measured against.
2. Sixty frames later, a **header-only entity delete**: a type the parser knows, declared length 8, and
   nothing after the header. The call is wrapped in `try/catch`, so on a released SDK the sign records the
   error that escaped the transport; on a fixed SDK it records that the parser returned.
3. Sixty frames after that, the readout switches to the `BUG REPRODUCED` text and that frame is allowed
   to finish, so the renderer actually receives it.
4. On the next frame the **zero-length** chunk goes in. On a released SDK that call never returns and the
   sign keeps the text from step 3 forever. On a fixed SDK the call returns and the sign flips to `FIXED`
   with a frame counter that keeps climbing, or to `PARTLY FIXED` if step 2 threw.

The verdict is arranged that way on purpose: a frozen scene cannot render anything after it freezes, so
the pessimistic message has to be on screen *before* the injection, and the survivable failure has to be
tested before the fatal one.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White while it counts down, red as soon as anything misbehaves, green and
counting when nothing does.

## Measured results

Headless, driving the same code path the scene drives (`addTransport`, then `onmessage`), against
`@dcl/sdk@7.26.0` and then against the same artifact with #1567's `crdtMessageProtocol.js`, `message.js`
and `systems/crdt/index.js` dropped into `@dcl/ecs/dist`. Each chunk runs in its own process with a
5-second limit:

| chunk | `@dcl/sdk@7.26.0` | with the fix |
| --- | --- | --- |
| control (unknown type, length 12) | returned | returned |
| header-only entity delete (known type, length 8) | **threw** `Outside of the bounds of writen data.` | returned |
| component update announcing 1000 bytes of data in a 24-byte frame | **threw** `Outside of the bounds of writen data.` | returned |
| zero-length header | **never returned**, killed at 5 s (`142`) | returned |

The control row is what rules out "unknown types are just broken": they are skipped correctly, it is
the frame that is never checked.

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

A fixed reader treats a known type whose frame cannot hold its body the way it treats an unknown type:
it skips the message by its declared length and reads on, so a valid message behind it still arrives.
A length below the header is different: once that is wrong there is no way to find where the next
message starts, so the reader stops there and drops the rest of the chunk. The scene therefore proves
the engine stays alive, not that the remainder of a chunk with a bad length survives.

`Transport` is typed under `@dcl/ecs/dist/systems/crdt/types` and not re-exported from `@dcl/sdk/ecs`,
which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
