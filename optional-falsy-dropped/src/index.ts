import { Engine, Entity, ISchema, Schemas, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
// The byte buffer the engine serializes components into is not re-exported
// from the package root.
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'

const FRAMES_BEFORE_RUN = 45

type Row = { label: string; sent: string; received: string; ok: boolean }

let sign: Entity
let frames = 0
let rows: Row[] = []
let done = false
let rendered = ''

/** Puts one optional value through the serializer the engine uses for CRDT. */
function roundTrip(label: string, schema: ISchema<unknown>, value: unknown): Row {
  const buffer = new ReadWriteByteBuffer()
  schema.serialize(value as never, buffer)
  const received = schema.deserialize(buffer)

  const sent = JSON.stringify(value)
  const back = JSON.stringify(received)

  return {
    label,
    sent: sent === undefined ? 'undefined' : sent,
    received: back === undefined ? 'undefined' : back,
    ok: sent === back
  }
}

function render() {
  const lines = ['optional values that are falsy']

  let verdict = ''
  if (done) {
    for (const row of rows) {
      lines.push(`${row.label}: sent ${row.sent}, read back ${row.received}`)
    }

    if (rows.every((row) => row.ok)) {
      verdict = 'FIXED: a falsy optional survives the round trip.'
    } else {
      verdict = 'BUG REPRODUCED: falsy values are written as absent, so they come back undefined.'
    }
    lines.push(verdict)
  } else {
    lines.push(`running in ${FRAMES_BEFORE_RUN - frames} frames`)
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

  if (!done && frames >= FRAMES_BEFORE_RUN) {
    rows = [
      roundTrip('optional boolean false', Schemas.Optional(Schemas.Boolean) as ISchema<unknown>, false),
      roundTrip('optional int 0', Schemas.Optional(Schemas.Int) as ISchema<unknown>, 0),
      roundTrip('optional string ""', Schemas.Optional(Schemas.String) as ISchema<unknown>, ''),
      roundTrip('optional boolean true', Schemas.Optional(Schemas.Boolean) as ISchema<unknown>, true)
    ]
    done = true
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
