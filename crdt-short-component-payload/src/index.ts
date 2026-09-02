import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
// The package root exports Transform already bound to the default engine. The
// probe below needs one bound to its own engine, so it takes the raw factory
// from @dcl/ecs/dist/components. The low-level types and writers are not
// re-exported from the SDK root either, so they come straight from @dcl/ecs too.
import { Transform as defineTransform } from '@dcl/ecs/dist/components'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { PutComponentOperation } from '@dcl/ecs/dist/serialization/crdt/putComponent'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'

// A CRDT PUT_COMPONENT carries the component's serialized value as its payload.
// The frame here is entirely well-formed — header, fields and the announced data
// length all agree — but the payload is far shorter than the Transform schema
// (position, rotation, scale, parent) needs. Reading the message succeeds; only
// the deserialize that the engine runs afterwards walks off the end of the buffer.
const SHORT_PAYLOAD_BYTES = 4

// Frames spent showing the starting state before anything is injected, so the
// readout is legible in-world before the scene either survives or dies.
const FRAMES_BEFORE_INJECTION = 60

type Phase = 'idle' | 'injected'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let updateThrew = false
let malformedEntityHasValue = false
let healthyEntityHasValue = false
let rendered = ''

// A private engine stands in for the scene's own one. In a real scene these
// messages arrive over comms and the runtime calls engine.update for you; here
// the scene drives its own engine so the failure is contained and observable.
// Transform has to be defined on this engine, or an incoming PUT for it is
// treated as an unknown component and never deserialized — which is the code
// path the bug lives in.
const probe = Engine()
const ProbeTransform = defineTransform(probe)
const transport: Transport = {
  send: async () => {},
  filter: () => false
}
probe.addTransport(transport)

// The malformed entity and a healthy one, delivered in the same chunk, so the
// scene also shows that the good message behind the bad one still lands.
const MALFORMED_ENTITY = 512 as Entity
const HEALTHY_ENTITY = 513 as Entity
const HEALTHY_POSITION = Vector3.create(4, 5, 6)

function craftShortTransformPut(entity: Entity): Uint8Array {
  const buffer = new ReadWriteByteBuffer()
  PutComponentOperation.write(entity, 1, ProbeTransform.componentId, new Uint8Array(SHORT_PAYLOAD_BYTES), buffer)
  return buffer.toBinary()
}

function craftHealthyTransformPut(entity: Entity): Uint8Array {
  const data = new ReadWriteByteBuffer()
  ProbeTransform.schema.serialize(
    {
      position: HEALTHY_POSITION,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: Vector3.create(1, 1, 1),
      parent: 0 as Entity
    },
    data
  )
  const buffer = new ReadWriteByteBuffer()
  PutComponentOperation.write(entity, 1, ProbeTransform.componentId, data.toBinary(), buffer)
  return buffer.toBinary()
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

function render() {
  const lines = ['CRDT component payload too short for its schema']

  let verdict = ''
  switch (phase) {
    case 'idle':
      lines.push(
        `injecting a Transform PUT with a ${SHORT_PAYLOAD_BYTES}-byte payload in ${FRAMES_BEFORE_INJECTION - frames} frames`
      )
      break
    case 'injected':
      if (updateThrew) {
        verdict =
          'BUG REPRODUCED: engine.update threw while deserializing the short payload, so the whole tick aborted and every other message in the batch was lost.'
      } else {
        const healthySurvived = healthyEntityHasValue && !malformedEntityHasValue
        verdict = healthySurvived
          ? 'FIXED: the malformed message was dropped, the well-formed one behind it still applied, and the tick finished.'
          : 'UNEXPECTED: update did not throw but the state is not what the fix should produce.'
      }
      lines.push(verdict)
      lines.push(`malformed entity has a Transform: ${malformedEntityHasValue}`)
      lines.push(`healthy entity has a Transform: ${healthyEntityHasValue}`)
      break
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  const failing = verdict.startsWith('BUG') || verdict.startsWith('UNEXPECTED')
  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.2,
    textColor: verdict === '' ? Color4.White() : failing ? Color4.Red() : Color4.Green(),
    width: 16,
    height: 8
  })
  console.log(text)
}

function driver() {
  frames++

  if (phase === 'idle' && frames >= FRAMES_BEFORE_INJECTION) {
    phase = 'injected'
    const chunk = concat(craftShortTransformPut(MALFORMED_ENTITY), craftHealthyTransformPut(HEALTHY_ENTITY))
    transport.onmessage!(chunk)
    // On a released SDK, engine.update deserializes the short payload and rejects.
    // The runtime driving a real scene would abort the tick the same way.
    probe
      .update(1)
      .then(() => {
        malformedEntityHasValue = ProbeTransform.getOrNull(MALFORMED_ENTITY) !== null
        healthyEntityHasValue = ProbeTransform.getOrNull(HEALTHY_ENTITY) !== null
      })
      .catch(() => {
        updateThrew = true
      })
      .then(() => render())
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
