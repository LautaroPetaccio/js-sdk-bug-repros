import { Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'

// Where the payload starts inside its backing array. Any non-zero value reproduces
// this; 8 is the kind of offset a header leaves in front of a message body.
const SLICE_OFFSET = 8
// Room the slice hands to the buffer before it has to grow.
const SLICE_LENGTH = 16
// Written before growth, so the copy into the larger allocation can be checked too.
const PREFIX = [0x11, 0x22, 0x33, 0x44]
// Large enough to outgrow SLICE_LENGTH and force a reallocation.
const FILLER_LENGTH = 1025
// Written after growth. These are the bytes that go missing.
const SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd]

type Result = {
  prefixIntact: boolean
  suffixAt: number
  suffixExpectedAt: number
  suffixIntact: boolean
  bytesAdrift: number
}

function findSequence(haystack: Uint8Array, needle: number[], from: number): number {
  for (let start = from; start <= haystack.length - needle.length; start++) {
    let matched = true
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matched = false
        break
      }
    }
    if (matched) return start
  }
  return -1
}

function measure(): Result {
  // A payload carved out of a larger array: byteOffset is SLICE_OFFSET, not 0.
  const backing = new Uint8Array(SLICE_OFFSET + SLICE_LENGTH)
  const sliced = backing.subarray(SLICE_OFFSET, SLICE_OFFSET + SLICE_LENGTH)
  const buffer = new ReadWriteByteBuffer(sliced, 0, 0)

  for (const byte of PREFIX) buffer.writeInt8(byte)

  // Outgrows the slice: the buffer allocates a standalone array and rebuilds its view.
  buffer.writeBuffer(new Uint8Array(FILLER_LENGTH), false)

  const suffixExpectedAt = buffer.currentWriteOffset()
  for (const byte of SUFFIX) buffer.writeInt8(byte)

  const written = buffer.toBinary()
  const suffixAt = findSequence(written, SUFFIX, 0)

  return {
    prefixIntact: findSequence(written, PREFIX, 0) === 0,
    suffixAt,
    suffixExpectedAt,
    suffixIntact: suffixAt === suffixExpectedAt,
    bytesAdrift: suffixAt < 0 ? SUFFIX.length : Math.abs(suffixAt - suffixExpectedAt)
  }
}

function render(result: Result) {
  const lines = ['ReadWriteByteBuffer offsets lost on growth']

  lines.push(`payload sliced at byteOffset ${SLICE_OFFSET}, ${SLICE_LENGTH} bytes of room`)
  lines.push(`wrote ${PREFIX.length} bytes, grew past the slice, wrote ${SUFFIX.length} more`)
  lines.push(`bytes written before growth survived: ${result.prefixIntact ? 'yes' : 'no'}`)
  lines.push(
    result.suffixAt < 0
      ? `bytes written after growth: nowhere in the buffer`
      : `bytes written after growth landed at ${result.suffixAt}, expected ${result.suffixExpectedAt}`
  )

  const reproduced = !result.suffixIntact
  const verdict = reproduced
    ? `BUG REPRODUCED: ${result.bytesAdrift} bytes adrift after the buffer grew`
    : 'FIXED: bytes written after growth land at their logical offset'
  lines.push(verdict)

  const text = lines.join('\n')
  const sign: Entity = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  TextShape.create(sign, {
    text,
    fontSize: 1.4,
    textColor: reproduced ? Color4.Red() : Color4.Green(),
    width: 14,
    height: 6
  })
  console.log(text)
}

export function main() {
  render(measure())
}
