# CRDT parser spinning on a zero-length message header

Reproduction scene for [js-sdk-toolchain#1567](https://github.com/decentraland/js-sdk-toolchain/pull/1567) —
_fix(ecs): reject CRDT messages shorter than their header_.

A CRDT chunk is a sequence of length-framed messages. A message whose header claims a length of **0**
makes the reader advance by zero bytes and read the same header again, forever. The scene thread is
single-threaded, so the scene is dead — no frames, no input, no recovery.

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
  ...
  } else {
    // consume the message
    buffer.incrementReadOffset(header.length)
  }
}
```

`incrementReadOffset(0)` is a no-op that does not even throw, so the loop never exits.

Only an unknown message type reaches that branch. A known type is read field by field, and a truncated
one throws out of `ByteBuffer` instead — noisy, but not a freeze.

## Who hits it

The chunk arrives straight from a transport's `onmessage`. In `@dcl/sdk` that is the comms path, so the
bytes come from **another player in the room**: one malformed 8-byte packet freezes every scene instance
that receives it. Nothing about it requires a hostile peer either — a truncated or mis-framed write by any
implementation of the wire format produces the same header.

## What the scene does

`src/index.ts` gives a private `Engine()` a transport and hands it two chunks by hand:

1. A **control** chunk: unknown type, honest length of 12. The parser skips it and returns, which is the
   behaviour the malformed case is measured against.
2. Sixty frames later, the readout switches to the `BUG REPRODUCED` text and that frame is allowed to
   finish, so the renderer actually receives it.
3. On the next frame the **zero-length** chunk goes in. On a released SDK that call never returns and the
   sign keeps the text from step 2 forever. On a fixed SDK the call returns and the sign flips to `FIXED`
   with a frame counter that keeps climbing.

The verdict is arranged that way on purpose: a frozen scene cannot render anything after it freezes, so
the pessimistic message has to be on screen *before* the injection.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White while it counts down, then red and frozen when the bug reproduces,
green and counting when it does not.

## Measured results

Headless, driving the same code path the scene drives (`addTransport`, then `onmessage`), against
`@dcl/sdk@7.26.0` and then against the same artifact with #1567's guard applied to
`@dcl/ecs/dist/serialization/crdt/crdtMessageProtocol.js`:

| | control chunk returns | zero-length chunk returns | process exit |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | yes | **no** | killed at 20 s (`142`) |
| with the guard | yes | yes | `0` |

The control column is what rules out "unknown types are just broken": they are skipped correctly, it is
the length that is not checked.

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

A fixed reader stops at the bad length and drops the rest of the chunk. That is deliberate: once a length
is wrong there is no way to find where the next message starts, so there is nothing to resynchronise to.
The scene therefore proves the engine stays alive, not that the remainder of a malformed chunk survives.

`Transport` is typed under `@dcl/ecs/dist/systems/crdt/types` and not re-exported from `@dcl/sdk/ecs`,
which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
