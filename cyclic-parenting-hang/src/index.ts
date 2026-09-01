import { Engine, Entity, TextShape, Transform, cyclicParentingChecker, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Transform as TransformComponent } from '@dcl/ecs/dist/components'

// Frames spent on each step, so the readout is legible in-world before the
// scene either survives the walk or dies inside it.
const FRAMES_PER_STEP = 60

type Phase = 'idle' | 'cycle-made' | 'armed' | 'walking' | 'survived'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let cycleReported = false
let cycleUpdateStarted = false
let framesAfterParenting = 0
let rendered = ''

// A private engine stands in for the scene's own one: the checker is an
// ordinary system, so a walk that never ends blocks the single scene thread
// wherever it runs.
const probe = Engine()
const ProbeTransform = TransformComponent(probe)
probe.addSystem(cyclicParentingChecker(probe))

const insideCycle = probe.addEntity()
const alsoInsideCycle = probe.addEntity()
const outsideCycle = probe.addEntity()

function render() {
  const lines = ['cyclic parenting checker']

  lines.push(`two entities parented into each other: ${cycleReported ? 'made, checker reported it' : 'not yet'}`)

  let verdict = ''
  switch (phase) {
    case 'idle':
      lines.push(`building the cycle in ${FRAMES_PER_STEP - frames} frames`)
      break
    case 'cycle-made':
      lines.push(`parenting a third entity onto it in ${FRAMES_PER_STEP * 2 - frames} frames`)
      break
    // Both of these show the pessimistic text. It has to be on screen before
    // the dangerous update runs, because a frozen scene renders nothing after.
    case 'armed':
    case 'walking':
      verdict =
        'BUG REPRODUCED: a third entity is parented onto the cycle now. If this text never changes again, the checker is walking that cycle forever and the scene is dead.'
      lines.push(verdict)
      break
    case 'survived':
      verdict = 'FIXED: the walk stopped at the repeated ancestor and the update finished.'
      lines.push(verdict)
      lines.push(`frames rendered after parenting onto the cycle: ${framesAfterParenting}`)
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
      if (frames >= FRAMES_PER_STEP && !cycleUpdateStarted) {
        cycleUpdateStarted = true
        // Two entities pointing at each other. Both are dirty on this tick, so
        // the checker finds the cycle from inside it and terminates.
        ProbeTransform.create(insideCycle).parent = alsoInsideCycle
        ProbeTransform.create(alsoInsideCycle).parent = insideCycle
        void probe.update(1 / 30).then(() => {
          cycleReported = true
          phase = 'cycle-made'
        })
      }
      break

    case 'cycle-made':
      if (frames >= FRAMES_PER_STEP * 2) {
        phase = 'armed'
      }
      break

    case 'armed':
      // From here the only dirty transform is the one outside the cycle, and
      // walking its ancestors is what never ends.
      ProbeTransform.create(outsideCycle).parent = insideCycle
      phase = 'walking'
      void probe.update(1 / 30).then(() => {
        phase = 'survived'
      })
      break

    case 'survived':
      framesAfterParenting++
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
