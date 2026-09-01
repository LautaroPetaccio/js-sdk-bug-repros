import { Entity, Raycast, TextShape, Transform, engine, raycastSystem } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const FRAMES_BEFORE_RUN = 45
// Frames to keep checking after the registration would have landed.
const FRAMES_WATCHED = 3

type Step = 'idle' | 'watching' | 'done'

let sign: Entity
let cancelled: Entity
let kept: Entity
let frames = 0
let step: Step = 'idle'
let watched = 0
let cancelledExists = false
let keptExists = false
let rendered = ''

function render() {
  const lines = ['a raycast registered and removed in the same frame']

  let verdict = ''
  if (step === 'done') {
    lines.push(`raycast asked for and then removed: ${cancelledExists ? 'still running' : 'gone'}`)
    lines.push(`raycast asked for and left alone: ${keptExists ? 'running' : 'gone'}`)

    if (!cancelledExists && keptExists) {
      verdict = 'FIXED: removing a raycast cancels the registration it undoes.'
    } else if (cancelledExists) {
      verdict = 'BUG REPRODUCED: the removal did not cancel the queued registration, so the renderer runs a query the scene withdrew.'
    } else {
      verdict = 'UNEXPECTED: the raycast that should have been kept is missing too.'
    }
    lines.push(verdict)
  } else {
    lines.push(step === 'idle' ? `running in ${FRAMES_BEFORE_RUN - frames} frames` : 'watching...')
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
        // Asked for and withdrawn before the frame is over.
        raycastSystem.registerLocalDirectionRaycast({ entity: cancelled }, () => {})
        raycastSystem.removeRaycasterEntity(cancelled)

        // The control: asked for and left alone.
        raycastSystem.registerLocalDirectionRaycast({ entity: kept }, () => {})
        step = 'watching'
      }
      break

    case 'watching':
      // Registration is delayed a frame, so the check has to outlast that.
      cancelledExists = cancelledExists || Raycast.has(cancelled)
      keptExists = keptExists || Raycast.has(kept)
      if (++watched >= FRAMES_WATCHED) {
        step = 'done'
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  cancelled = engine.addEntity()
  kept = engine.addEntity()
  engine.addSystem(driver, 0, 'repro/driver')
}
