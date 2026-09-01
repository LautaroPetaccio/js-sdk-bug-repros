import { Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { PALETTE, Panel, STARTING_ALPHA } from './ui'

// Frames to let the UI render before reading the palette back.
const FRAMES_MEASURED = 6

let sign: Entity
let frames = 0
let rendered = ''

function render() {
  const lines = ['a disabled Button and the scene palette it was handed']

  lines.push(`frames rendered: ${frames}`)
  lines.push(`alpha of the entry the button was given: ${PALETTE.brand.a}`)
  lines.push(`alpha of the entry it never saw: ${PALETTE.untouched.a}`)

  let verdict = ''
  if (frames >= FRAMES_MEASURED) {
    if (PALETTE.brand.a === STARTING_ALPHA) {
      verdict = 'FIXED: the button dims itself and leaves the scene palette alone.'
    } else {
      verdict = `BUG REPRODUCED: the palette entry the button was given has been halved ${frames} times, so everything drawn with it is fading out.`
    }
    lines.push(verdict)
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
  // The UI renders once per frame, which is what makes the halving compound.
  if (frames <= FRAMES_MEASURED) frames++
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  ReactEcsRenderer.setUiRenderer(Panel)
  engine.addSystem(driver, 0, 'repro/driver')
}
