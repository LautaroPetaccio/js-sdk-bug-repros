import { Entity, TextShape, Transform, UiInput, UiInputResult, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { Panel, state } from './ui'

const FRAMES_BEFORE_RUN = 30

type Step =
  | 'idle'
  | 'dropped-handler'
  | 'typed-into-dropped'
  | 'typed-into-restorable'
  | 'echoed'
  | 'cleared'
  | 'restored'
  | 'done'

let sign: Entity
let frames = 0
let step: Step = 'idle'
let droppedHandlerCalls = 0
let restoredValueInField = ''
let rendered = ''

function inputEntities(): Entity[] {
  const found: Entity[] = []
  for (const [entity] of engine.getEntitiesWith(UiInput)) found.push(entity)
  return found
}

function render() {
  const lines = ['an Input whose handler is dropped, and one whose value is restored']

  let verdict = ''
  if (step === 'done') {
    lines.push(`handler that is no longer rendered was called: ${droppedHandlerCalls} time(s), should be 0`)
    lines.push(`field after the scene restored what was typed: "${restoredValueInField}", should be "gm"`)

    if (droppedHandlerCalls === 0 && restoredValueInField === 'gm') {
      verdict = 'FIXED: handlers stop when they stop being rendered, and a restored value reaches the field.'
    } else {
      verdict = 'BUG REPRODUCED: a dropped handler still fires and a restored value is mistaken for an echo.'
    }
    lines.push(verdict)
  } else {
    lines.push(step === 'idle' ? `running in ${FRAMES_BEFORE_RUN - frames} frames` : 'measuring...')
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
  const [dropped, restorable] = inputEntities()

  switch (step) {
    case 'idle':
      if (frames >= FRAMES_BEFORE_RUN && dropped !== undefined) {
        // Stop rendering the handler, the way a conditional spread does.
        state.editing = false
        step = 'dropped-handler'
      }
      break

    case 'dropped-handler':
      // The player types into that field anyway.
      UiInputResult.createOrReplace(dropped, { value: 'typed' })
      step = 'typed-into-dropped'
      break

    case 'typed-into-dropped':
      // And into the second one, which the renderer reports back.
      UiInputResult.createOrReplace(restorable, { value: 'gm' })
      step = 'echoed'
      break

    case 'echoed':
      // React re-renders with what it was told, which is the echo to drop.
      step = 'cleared'
      break

    case 'cleared':
      // The scene clears the field, the way a chat box does after sending.
      state.restoredValue = ''
      step = 'restored'
      break

    case 'restored':
      // And puts back what was typed.
      state.restoredValue = 'gm'
      step = 'done'
      break

    case 'done':
      if (restoredValueInField === '') {
        restoredValueInField = UiInput.getOrNull(restorable)?.value ?? ''
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  state.onChange = () => {
    droppedHandlerCalls++
  }
  state.onRestoredChange = (value: string) => {
    state.restoredValue = value
  }

  ReactEcsRenderer.setUiRenderer(Panel)
  engine.addSystem(driver, 0, 'repro/driver')
}
