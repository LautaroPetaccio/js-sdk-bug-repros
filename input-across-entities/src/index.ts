import { Engine, Entity, InputAction, PointerEventType, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { PointerEventsResult } from '@dcl/ecs/dist/components'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { createInputSystem, IInputSystem } from '@dcl/ecs/dist/engine/input'

const FRAMES_BEFORE_INPUT = 60

type Phase = 'idle' | 'reported'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let keyPressed = false
let keyTriggeredGlobally = false
let keyTriggeredOnItsEntity = false
let rendered = ''

// A private engine keeps the renderer out of it: this scene has to write the
// pointer results itself, which is what the renderer normally does.
const probe = Engine()
const ProbePointerEventsResult = PointerEventsResult(probe)
const probeInput: IInputSystem = createInputSystem(probe)

const clickedEntity = probe.addEntity()
const otherEntity = probe.addEntity()

/** One pointer result, shaped the way the renderer reports one. */
function pointerResult(entity: Entity, timestamp: number, state: PointerEventType, button: InputAction) {
  return {
    button,
    timestamp,
    state,
    analog: 1,
    tickNumber: 0,
    hit: {
      position: Vector3.create(1, 1, 1),
      length: 1,
      direction: Vector3.create(1, 0, 0),
      normalHit: Vector3.create(0, 1, 0),
      globalOrigin: Vector3.create(0, 0, 0),
      meshName: 'mesh',
      entityId: entity as number
    }
  }
}

/**
 * The player releases the pointer over one entity, and over another one they
 * had pressed a key and clicked slightly earlier. Timestamps are a single
 * counter shared by every entity, so these interleave.
 */
function reportInput() {
  ProbePointerEventsResult.addValue(
    clickedEntity,
    pointerResult(clickedEntity, 3, PointerEventType.PET_UP, InputAction.IA_POINTER)
  )
  ProbePointerEventsResult.addValue(
    otherEntity,
    pointerResult(otherEntity, 1, PointerEventType.PET_DOWN, InputAction.IA_PRIMARY)
  )
  ProbePointerEventsResult.addValue(
    otherEntity,
    pointerResult(otherEntity, 2, PointerEventType.PET_DOWN, InputAction.IA_POINTER)
  )
}

function render() {
  const lines = ['a key pressed over one entity, a pointer released over another']

  let verdict = ''
  if (phase === 'reported') {
    lines.push(`isPressed(IA_PRIMARY): ${keyPressed}`)
    lines.push(`isTriggered(IA_PRIMARY, PET_DOWN): ${keyTriggeredGlobally}`)
    lines.push(`isTriggered(IA_PRIMARY, PET_DOWN, thatEntity): ${keyTriggeredOnItsEntity}`)

    if (!keyPressed && !keyTriggeredGlobally && keyTriggeredOnItsEntity) {
      verdict =
        'BUG REPRODUCED: the key press is visible on its own entity but not globally, because the other entity reported a newer input first.'
    } else if (keyPressed && keyTriggeredGlobally && keyTriggeredOnItsEntity) {
      verdict = 'FIXED: the key press is visible everywhere.'
    } else {
      verdict = `UNEXPECTED: pressed=${keyPressed} global=${keyTriggeredGlobally} entity=${keyTriggeredOnItsEntity}`
    }
    lines.push(verdict)
  } else {
    lines.push(`reporting the input in ${FRAMES_BEFORE_INPUT - frames} frames`)
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

  if (phase === 'idle' && frames >= FRAMES_BEFORE_INPUT) {
    reportInput()
    void probe.update(1 / 30).then(() => {
      keyPressed = probeInput.isPressed(InputAction.IA_PRIMARY)
      keyTriggeredGlobally = probeInput.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
      keyTriggeredOnItsEntity = probeInput.isTriggered(
        InputAction.IA_PRIMARY,
        PointerEventType.PET_DOWN,
        otherEntity
      )
      phase = 'reported'
    })
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
