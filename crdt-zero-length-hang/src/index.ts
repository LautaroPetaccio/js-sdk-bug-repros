import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
// The transport type is not re-exported from the package root.
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'

// A CRDT chunk is a sequence of length-framed messages. The header is 8 bytes:
// uint32 length (the whole message, header included) and uint32 type. The
// protocol documents 8 as the minimum length, but the reader never checks it,
// and a type it knows is read field by field without checking the frame holds them.
const HEADER_LENGTH = 8
// Any value at or above MAX_MESSAGE_TYPE takes the parser's "unknown message"
// branch, which is the branch that advances the cursor by the header's length.
const UNKNOWN_MESSAGE_TYPE = 0xffff
// A type the parser knows. Its reader expects a 4-byte entity id after the header.
const DELETE_ENTITY_TYPE = 3

// Frames spent showing the starting state before anything is injected, so the
// readout is legible in-world before the scene either survives or dies.
const FRAMES_BEFORE_CONTROL = 60
// The header-only frame goes in next. On a released SDK it throws out of the
// transport, which the scene catches, so it is safe to send before the hang.
const FRAMES_BEFORE_SHORT_FRAME = 120
// The armed message has to reach the renderer before the parser is allowed to
// hang, otherwise the frozen scene shows whatever was on screen a frame earlier.
const FRAMES_BEFORE_INJECTION = 180

type Phase = 'idle' | 'control-sent' | 'short-frame-sent' | 'armed' | 'survived'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let controlSurvived = false
let shortFrameOutcome = ''
let framesAfterInjection = 0
let rendered = ''

/** A frame with the given header followed by zero bytes up to `totalBytes`. */
function craftFrame(
  type: number,
  declaredLength: number,
  totalBytes = Math.max(declaredLength, HEADER_LENGTH)
): Uint8Array {
  const bytes = new Uint8Array(totalBytes)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, declaredLength, true)
  view.setUint32(4, type, true)
  return bytes
}

/** A well-formed message of a type this SDK does not know: length is honest. */
const controlChunk = () => craftFrame(UNKNOWN_MESSAGE_TYPE, HEADER_LENGTH + 4)
/** A type the SDK knows, but the frame is only the header: the reader wants 4 bytes that are not there. */
const headerOnlyDeleteChunk = () => craftFrame(DELETE_ENTITY_TYPE, HEADER_LENGTH)
/** The unknown type again, but claiming a length of zero. */
const zeroLengthChunk = () => craftFrame(UNKNOWN_MESSAGE_TYPE, 0)

// A private engine stands in for the scene's own one. The parser runs inside
// the transport's onmessage callback, so a chunk handed to this engine hangs
// the single scene thread exactly like one arriving over comms would.
const probe = Engine()
const transport: Transport = {
  send: async () => {},
  filter: () => false
}
probe.addTransport(transport)

/** Hands a chunk to the parser the way a transport delivers one. */
function deliver(chunk: Uint8Array) {
  transport.onmessage!(chunk)
}

function shortFrameThrew() {
  return shortFrameOutcome.startsWith('BUG')
}

function render() {
  const lines = ['CRDT malformed message frames']

  lines.push(
    `control chunk (unknown type, length ${HEADER_LENGTH + 4}): ${controlSurvived ? 'skipped, parser returned' : 'not sent yet'}`
  )
  lines.push(`header-only entity delete (known type, length ${HEADER_LENGTH}): ${shortFrameOutcome || 'not sent yet'}`)

  let verdict = ''
  switch (phase) {
    case 'idle':
      lines.push(`sending the control chunk in ${FRAMES_BEFORE_CONTROL - frames} frames`)
      break
    case 'control-sent':
      lines.push(`sending the header-only entity delete in ${FRAMES_BEFORE_SHORT_FRAME - frames} frames`)
      break
    case 'short-frame-sent':
      lines.push(`sending a chunk with length 0 in ${FRAMES_BEFORE_INJECTION - frames} frames`)
      break
    case 'armed':
      verdict =
        'BUG REPRODUCED: the zero-length chunk goes in on the next frame. If this text never changes again, the parse loop is spinning on a header that never advances the cursor and the scene is dead.'
      lines.push(verdict)
      break
    case 'survived':
      verdict = shortFrameThrew()
        ? 'PARTLY FIXED: the zero-length header is rejected, but the header-only entity delete still threw out of the transport.'
        : 'FIXED: both malformed frames were rejected and the parser returned.'
      lines.push(verdict)
      lines.push(`frames rendered after the injection: ${framesAfterInjection}`)
      break
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  const failing = verdict.startsWith('BUG') || verdict.startsWith('PARTLY') || (verdict === '' && shortFrameThrew())
  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.2,
    textColor: verdict === '' && !shortFrameThrew() ? Color4.White() : failing ? Color4.Red() : Color4.Green(),
    width: 16,
    height: 8
  })
  console.log(text)
}

function driver() {
  frames++

  switch (phase) {
    case 'idle':
      if (frames >= FRAMES_BEFORE_CONTROL) {
        // An unknown type with an honest length is skipped and the parser moves
        // on, which is the behaviour both malformed cases are measured against.
        deliver(controlChunk())
        controlSurvived = true
        phase = 'control-sent'
      }
      break

    case 'control-sent':
      if (frames >= FRAMES_BEFORE_SHORT_FRAME) {
        // On an SDK carrying the bug the reader runs past the end of the chunk
        // and the byte buffer throws straight out of the transport.
        try {
          deliver(headerOnlyDeleteChunk())
          shortFrameOutcome = 'skipped, parser returned'
        } catch (err) {
          shortFrameOutcome = `BUG: threw out of the transport: ${err}`
        }
        phase = 'short-frame-sent'
      }
      break

    case 'short-frame-sent':
      if (frames >= FRAMES_BEFORE_INJECTION) {
        phase = 'armed'
      }
      break

    case 'armed':
      // On an SDK carrying the bug this call never returns.
      deliver(zeroLengthChunk())
      phase = 'survived'
      break

    case 'survived':
      framesAfterInjection++
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
