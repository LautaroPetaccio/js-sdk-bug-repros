import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Transform as TransformComponent } from '@dcl/ecs/dist/components'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { readMessage } from '@dcl/ecs/dist/serialization/crdt/message'
import { CrdtMessageType } from '@dcl/ecs/dist/serialization/crdt/types'

const FRAMES_BEFORE_RUN = 45
// Entities created and deleted, the way a scene spawning projectiles does.
const CHURN_CYCLES = 25

let sign: Entity
let frames = 0
let done = false
let liveEntities = -1
let tombstones = -1
let dumpBytes = -1
let rendered = ''

async function measure() {
  const probe = Engine()
  const ProbeTransform = TransformComponent(probe)

  for (let cycle = 0; cycle < CHURN_CYCLES; cycle++) {
    const entity = probe.addEntity()
    ProbeTransform.create(entity)
    await probe.update(1 / 30)
    probe.removeEntity(entity)
    await probe.update(1 / 30)
  }

  liveEntities = 0
  for (const _ of probe.getEntitiesWith(ProbeTransform)) liveEntities++

  // Exactly what a player joining later is handed as the starting state.
  const buffer = new ReadWriteByteBuffer()
  ProbeTransform.dumpCrdtStateToBuffer(buffer)
  dumpBytes = buffer.currentWriteOffset()

  tombstones = 0
  let message
  while ((message = readMessage(buffer))) {
    if (message.type === CrdtMessageType.DELETE_COMPONENT) tombstones++
  }
}

function render() {
  const lines = [`${CHURN_CYCLES} entities created and deleted`]

  let verdict = ''
  if (done) {
    lines.push(`entities still alive: ${liveEntities}`)
    lines.push(`tombstones a late joiner is sent: ${tombstones}`)
    lines.push(`bytes of state for those entities: ${dumpBytes}`)

    if (tombstones === 0 && dumpBytes === 0) {
      verdict = 'FIXED: nothing of the deleted entities is kept or sent.'
    } else {
      verdict = `BUG REPRODUCED: one entry per deleted entity is kept for the life of the scene, and re-sent to everyone who joins.`
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
    void measure().then(() => {
      done = true
    })
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
