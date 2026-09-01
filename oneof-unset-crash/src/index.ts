import { Engine, Entity, Schemas, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Frames spent showing the starting state before the component is created.
const FRAMES_BEFORE_CREATE = 60

type Phase = 'idle' | 'created' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let updateError = ''
let updatesCompleted = 0
let rendered = ''

// A private engine keeps the failure measurable. The same component on the
// scene's own engine throws out of the scene's update instead, which the host
// reports as a scene error rather than something this readout can catch.
const probe = Engine()
const Choice = probe.defineComponent('repro::choice', {
  pick: Schemas.OneOf({ velocity: Schemas.Int, label: Schemas.String })
})

/** Creates the component and leaves its OneOf field alone, as a scene would. */
function createWithUnsetCase() {
  Choice.create(probe.addEntity())
}

function render() {
  const lines = ['component with an unset Schemas.OneOf field']

  let verdict = ''
  switch (phase) {
    case 'idle':
      lines.push(`creating the component in ${FRAMES_BEFORE_CREATE - frames} frames`)
      break
    case 'created':
      lines.push('component created, running the update that serializes it...')
      break
    case 'done':
      if (updateError) {
        verdict = 'BUG REPRODUCED: the update that serializes the component threw.'
        lines.push(verdict)
        lines.push(updateError)
        lines.push('In a real scene this is the scene update, so the whole tick dies, every tick.')
      } else {
        verdict = 'FIXED: the unset case serialized and the update finished.'
        lines.push(verdict)
        lines.push(`updates completed since: ${updatesCompleted}`)
      }
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
      if (frames >= FRAMES_BEFORE_CREATE) {
        createWithUnsetCase()
        phase = 'created'
        probe
          .update(1 / 30)
          .then(() => {
            phase = 'done'
          })
          .catch((error: unknown) => {
            updateError = `${error}`
            phase = 'done'
          })
      }
      break

    case 'done':
      if (!updateError) {
        // Keep going to show the engine is healthy rather than merely quiet.
        void probe.update(1 / 30).then(() => {
          updatesCompleted++
        })
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
