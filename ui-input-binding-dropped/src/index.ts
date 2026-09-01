import { Entity, TextShape, Transform, UiInputBinding, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { Panel } from './ui'

// Frames to let the UI mount before counting.
const FRAMES_BEFORE_COUNT = 30

// One bare UiEntity plus four wrapper components, all asking for a binding.
const ELEMENTS_ASKING_FOR_A_BINDING = 5

let sign: Entity
let frames = 0
let bindings = -1
let rendered = ''

function render() {
  const lines = ['uiInputBinding across the UI components']

  let verdict = ''
  if (bindings >= 0) {
    lines.push(`elements asking for a binding: ${ELEMENTS_ASKING_FOR_A_BINDING}`)
    lines.push(`UiInputBinding components in the engine: ${bindings}`)

    if (bindings === ELEMENTS_ASKING_FOR_A_BINDING) {
      verdict = 'FIXED: every component passes the binding through.'
    } else {
      verdict = `BUG REPRODUCED: ${ELEMENTS_ASKING_FOR_A_BINDING - bindings} of them swallowed it, so those keys are bound to nothing.`
    }
    lines.push(verdict)
  } else {
    lines.push(`counting in ${FRAMES_BEFORE_COUNT - frames} frames`)
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

  if (bindings < 0 && frames >= FRAMES_BEFORE_COUNT) {
    let found = 0
    for (const _ of engine.getEntitiesWith(UiInputBinding)) found++
    bindings = found
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  ReactEcsRenderer.setUiRenderer(Panel)
  engine.addSystem(driver, 0, 'repro/driver')
}
