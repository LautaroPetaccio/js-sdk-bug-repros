import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
// The transport type is not re-exported from the package root.
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'

// A CRDT chunk is a sequence of length-framed messages. The header is 8 bytes:
// uint32 length (the whole message, header included) and uint32 type. The
// protocol documents 8 as the minimum length, but the reader never checks it.
const HEADER_LENGTH = 8
// Any value at or above MAX_MESSAGE_TYPE takes the parser's "unknown message"
// branch, which is the branch that advances the cursor by the header's length.
const UNKNOWN_MESSAGE_TYPE = 0xffff

// Frames spent showing the starting state before anything is injected, so the
// readout is legible in-world before the scene either survives or dies.
const FRAMES_BEFORE_CONTROL = 60
// Frames between the control chunk and the malformed one. The armed message has
// to reach the renderer before the parser is allowed to hang, otherwise the
// frozen scene shows whatever was on screen a frame earlier.
const FRAMES_BEFORE_INJECTION = 60

type Phase = 'idle' | 'control-sent' | 'armed' | 'survived'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let controlSurvived = false
let framesAfterInjection = 0
let rendered = ''

/** A well-formed message of a type this SDK does not know: length is honest. */
function craftUnknownMessage(): Uint8Array {
  const bytes = new Uint8Array(HEADER_LENGTH + 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length, true)
  view.setUint32(4, UNKNOWN_MESSAGE_TYPE, true)
  return bytes
}

/** The same unknown type, but claiming a length of zero. */
function craftZeroLengthMessage(): Uint8Array {
  const bytes = new Uint8Array(HEADER_LENGTH)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0, true)
  view.setUint32(4, UNKNOWN_MESSAGE_TYPE, true)
  return bytes
}

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

function render() {
  const lines = ['CRDT zero-length message header']

  lines.push(`control chunk (unknown type, length ${HEADER_LENGTH + 4}): ${controlSurvived ? 'skipped, parser returned' : 'not sent yet'}`)

  let verdict = ''
  switch (phase) {
    case 'idle':
      lines.push(`sending the control chunk in ${FRAMES_BEFORE_CONTROL - frames} frames`)
      break
    case 'control-sent':
      lines.push(`sending a chunk with length 0 in ${FRAMES_BEFORE_CONTROL + FRAMES_BEFORE_INJECTION - frames} frames`)
      break
    case 'armed':
      verdict =
        'BUG REPRODUCED: the zero-length chunk goes in on the next frame. If this text never changes again, the parse loop is spinning on a header that never advances the cursor and the scene is dead.'
      lines.push(verdict)
      break
    case 'survived':
      verdict = 'FIXED: the parser rejected the zero-length header and returned.'
      lines.push(verdict)
      lines.push(`frames rendered after the injection: ${framesAfterInjection}`)
      break
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.2,
    textColor: verdict === '' ? Color4.White() : verdict.startsWith('BUG') ? Color4.Red() : Color4.Green(),
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
        // on, which is the behaviour the zero-length case is measured against.
        deliver(craftUnknownMessage())
        controlSurvived = true
        phase = 'control-sent'
      }
      break

    case 'control-sent':
      if (frames >= FRAMES_BEFORE_CONTROL + FRAMES_BEFORE_INJECTION) {
        phase = 'armed'
      }
      break

    case 'armed':
      // On an SDK carrying the bug this call never returns.
      deliver(craftZeroLengthMessage())
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
