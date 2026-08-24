# ByteBuffer offsets lost on growth

Reproduction scene for [js-sdk-toolchain#1460](https://github.com/decentraland/js-sdk-toolchain/pull/1460) —
_fix(ecs): preserve ByteBuffer offsets during growth_.

A `ReadWriteByteBuffer` built over a **slice** of a larger array writes to the wrong place as soon as it
outgrows that slice. Everything written before the growth survives; everything written after it lands
`byteOffset` bytes too far, past the end of what `toBinary()` returns.

## The bug

`packages/@dcl/ecs/src/serialization/ByteBuffer/index.ts`, `incrementWriteOffset()`:

```ts
const newBuffer = new Uint8Array(newsize)
newBuffer.set(this._buffer)
const oldOffset = this._buffer.byteOffset
this._buffer = newBuffer
this.view = new DataView(this._buffer.buffer, oldOffset)
```

`this._buffer` is the slice, so `byteOffset` is where the payload sits inside its backing array — 8, say.
The replacement is a standalone `Uint8Array`, so its payload starts at 0. Rebuilding the view at the *old*
offset shifts every later `setUint8`/`setUint32` 8 bytes forward, while `toBinary()` keeps reading from
`_buffer` at 0. The bytes are written into the buffer's tail, outside the region anyone reads back.

The fix rebuilds the view from the new allocation's own offset and length:

```ts
this.view = new DataView(this._buffer.buffer, this._buffer.byteOffset, this._buffer.byteLength)
```

A slice offset larger than the new allocation would push the view start past the buffer and throw
`RangeError` outright. The common case is quieter: the write simply goes missing.

## Who hits it

Every `new ReadWriteByteBuffer(someUint8Array)` inside `@dcl/ecs` today is a *reader* — CRDT chunk parsing,
component deserialization, the logger transport — and readers never grow, so the SDK does not trip over
this itself. What it bites is code that **writes** into a buffer carved out of a larger array: scene code
building custom binary payloads for the message bus, and libraries assembling CRDT frames on borrowed
memory. `subarray()` is the ordinary way to get there, and it is exactly what leaves `byteOffset` non-zero.

## What the scene does

`src/index.ts`, once, at startup:

1. Carves a 16-byte slice out of a 24-byte array, so the payload starts at `byteOffset` 8.
2. Writes 4 marker bytes, well inside the slice.
3. Writes 1025 bytes, which outgrows the slice and forces the reallocation.
4. Writes 4 more marker bytes and records the write offset they were meant to land at.
5. Searches the buffer for both markers.

The first marker checks that growth copied the existing bytes; the second is the one that goes missing.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the bug reproduces, green when the bytes land where they belong.
There is nothing to wait for — the measurement is synchronous, so the sign is already final when the scene
loads.

## Measured results

Run headlessly against `@dcl/sdk@7.26.0`, and then against the same artifact with PR #1460 applied to
`@dcl/ecs/dist/serialization/ByteBuffer/index.js`:

| | bytes written before growth | bytes written after growth |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | intact at 0 | **nowhere in the buffer** — 4 bytes adrift |
| with the fix | intact at 0 | at 1029, as expected |

The slice offset is 8 and the misplacement is 8 bytes, which is what ties the loss to `oldOffset` rather
than to the size of the write that triggered the growth.

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

`ReadWriteByteBuffer` is not re-exported from `@dcl/sdk/ecs`, so the scene imports it from
`@dcl/ecs/dist/serialization/ByteBuffer` — the same deep path the SDK itself uses internally. That is why
`@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
