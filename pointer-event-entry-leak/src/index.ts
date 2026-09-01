import { Engine, Entity, InputAction, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
// The per-engine component factory and the system constructor are not
// re-exported from the package root.
import { PointerEvents } from '@dcl/ecs/dist/components'
import { createPointerEventsSystem } from '@dcl/ecs/dist/systems/events'
import { createInputSystem } from '@dcl/ecs/dist/engine/input'

const FRAMES_BEFORE_RUN = 45
// How many times a UI element is toggled between having a handler and not.
const TOGGLES = 5

type Phase = 'idle' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''

// What the run measured.
let afterRegister = 0
let afterRemove = 0
let afterToggles = 0
let cursorSurvivedProximity = false
let proximityRemovable = false

// A private engine keeps the counts readable: this scene needs to inspect the
// PointerEvents component the renderer would receive.
const probe = Engine()
const ProbePointerEvents = PointerEvents(probe)
const pointerEvents = createPointerEventsSystem(probe, createInputSystem(probe))

function entriesOn(entity: Entity) {
  const component = ProbePointerEvents.getOrNull(entity)
  return component ? component.pointerEvents.length : 0
}

/**
 * A handler with no hover text, which is what React UI registers for
 * onMouseDown and friends.
 */
function measureAccumulation() {
  const entity = probe.addEntity()

  pointerEvents.onPointerDown(entity, () => {})
  afterRegister = entriesOn(entity)

  pointerEvents.removeOnPointerDown(entity)
  afterRemove = entriesOn(entity)

  for (let toggle = 0; toggle < TOGGLES; toggle++) {
    pointerEvents.onPointerDown(entity, () => {})
    pointerEvents.removeOnPointerDown(entity)
  }
  afterToggles = entriesOn(entity)
}

/** A cursor handler and a proximity handler on the same entity. */
function measureProximityCollision() {
  const entity = probe.addEntity()

  pointerEvents.onPointerDown({ entity, opts: { button: InputAction.IA_POINTER, hoverText: 'cursor' } }, () => {})
  pointerEvents.onProximityDown({ entity, opts: { button: InputAction.IA_POINTER, hoverText: 'proximity' } }, () => {})

  const described = ProbePointerEvents.get(entity).pointerEvents.map((pointer) => pointer.eventInfo?.hoverText)
  cursorSurvivedProximity = described.includes('cursor')

  pointerEvents.removeOnProximityDown(entity)
  const left = ProbePointerEvents.get(entity).pointerEvents.map((pointer) => pointer.eventInfo?.hoverText)
  proximityRemovable = !left.includes('proximity')
}

function render() {
  const lines = ['PointerEvents entries against their handlers']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`entries after registering one handler: ${afterRegister}`)
    lines.push(`after removing it (should be 0): ${afterRemove}`)
    lines.push(`after ${TOGGLES} add/remove cycles (should be 0): ${afterToggles}`)
    lines.push(`a cursor handler survives a proximity one: ${cursorSurvivedProximity}`)
    lines.push(`a proximity handler can be removed: ${proximityRemovable}`)

    if (afterRemove === 0 && afterToggles === 0 && cursorSurvivedProximity && proximityRemovable) {
      verdict = 'FIXED: entries come and go with their handlers.'
    } else {
      verdict =
        'BUG REPRODUCED: entries outlive the handlers that made them, so the renderer keeps offering interactions nothing listens to.'
    }
    lines.push(verdict)
  } else {
    lines.push(`measuring in ${FRAMES_BEFORE_RUN - frames} frames`)
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

  if (phase === 'idle' && frames >= FRAMES_BEFORE_RUN) {
    measureAccumulation()
    measureProximityCollision()
    phase = 'done'
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
