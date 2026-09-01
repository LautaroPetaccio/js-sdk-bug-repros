import { Entity, PhysicsCombinedForce, Physics, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

type Vector3Type = { x: number; y: number; z: number }

const FRAMES_BEFORE_RUN = 45
// Frames to watch the force after it was applied.
const FRAMES_WATCHED = 3

type Step = 'idle' | 'applied' | 'done'

let sign: Entity
let source: Entity
let frames = 0
let step: Step = 'idle'
let watched = 0
let rightAfterApplying: Vector3Type | undefined
let afterTicks: Vector3Type | undefined
let rendered = ''

const APPLIED_FORCE = Vector3.create(0, 7, 0)

function currentForce(): Vector3Type | undefined {
  const component = PhysicsCombinedForce.getOrNull(engine.PlayerEntity)
  return component?.vector
}

function show(vector: Vector3Type | undefined) {
  return vector ? `(${vector.x}, ${vector.y}, ${vector.z})` : 'none'
}

function render() {
  const lines = ['a force applied to a source that already had a repulsion']

  let verdict = ''
  if (step === 'done') {
    lines.push(`force right after applying: ${show(rightAfterApplying)}`)
    lines.push(`force ${FRAMES_WATCHED} ticks later: ${show(afterTicks)}`)

    const stayed =
      afterTicks !== undefined &&
      afterTicks.x === APPLIED_FORCE.x &&
      afterTicks.y === APPLIED_FORCE.y &&
      afterTicks.z === APPLIED_FORCE.z

    verdict = stayed
      ? 'FIXED: the force the scene applied is the force the player keeps.'
      : 'BUG REPRODUCED: the repulsion was still registered for that source and overwrote the force on the next tick.'
    lines.push(verdict)
  } else {
    lines.push(step === 'idle' ? `applying in ${FRAMES_BEFORE_RUN - frames} frames` : 'watching the force...')
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

  switch (step) {
    case 'idle':
      if (frames >= FRAMES_BEFORE_RUN) {
        // A knockback away from the origin, then a plain lift from the same
        // source, which is meant to replace it.
        Physics.applyRepulsionForceToPlayer(source, Vector3.create(0, 0, 0), 5)
        Physics.applyForceToPlayer(source, APPLIED_FORCE)
        rightAfterApplying = currentForce()
        step = 'applied'
      }
      break

    case 'applied':
      if (++watched >= FRAMES_WATCHED) {
        afterTicks = currentForce()
        step = 'done'
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  source = engine.addEntity()
  engine.addSystem(driver, 0, 'repro/driver')
}
