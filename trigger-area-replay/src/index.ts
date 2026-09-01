import {
  Entity,
  TextShape,
  Transform,
  TriggerAreaEventType,
  TriggerAreaResult,
  engine,
  triggerAreaEventsSystem
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const FRAMES_BEFORE_RUN = 45

type Step = 'idle' | 'walked-through' | 'swapped' | 'measured-stale' | 'done'

let sign: Entity
let area: Entity
let player: Entity
let frames = 0
let step: Step = 'idle'
let calls = 0
let staleCalls = -1
let freshCalls = -1
let rendered = ''

function result(eventType: TriggerAreaEventType, timestamp: number) {
  return {
    triggeredEntity: area as number,
    triggeredEntityPosition: Vector3.create(0, 0, 0),
    triggeredEntityRotation: { x: 0, y: 0, z: 0, w: 1 },
    eventType,
    timestamp,
    trigger: {
      entity: player as number,
      layers: 0,
      position: Vector3.create(0, 0, 0),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: Vector3.create(1, 1, 1)
    }
  }
}

function render() {
  const lines = ['swapping a trigger area handler']

  let verdict = ''
  if (step === 'done') {
    lines.push(`fired for events the previous handler already saw: ${staleCalls} (should be 0)`)
    lines.push(`fired for the entry that happened after the swap: ${freshCalls} (should be 1)`)

    if (staleCalls === 0 && freshCalls === 1) {
      verdict = 'FIXED: the new handler starts from now.'
    } else {
      verdict = 'BUG REPRODUCED: the new handler was handed the area event history, for a player long gone.'
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

  switch (step) {
    case 'idle':
      if (frames >= FRAMES_BEFORE_RUN) {
        // A player walks in and out while the first handlers are listening.
        triggerAreaEventsSystem.onTriggerEnter(area, () => {})
        triggerAreaEventsSystem.onTriggerExit(area, () => {})
        TriggerAreaResult.addValue(area, result(TriggerAreaEventType.TAET_ENTER, 1))
        TriggerAreaResult.addValue(area, result(TriggerAreaEventType.TAET_EXIT, 2))
        step = 'walked-through'
      }
      break

    case 'walked-through':
      // The scene swaps the handler, which is the ordinary way in.
      triggerAreaEventsSystem.removeOnTriggerEnter(area)
      triggerAreaEventsSystem.removeOnTriggerExit(area)
      triggerAreaEventsSystem.onTriggerEnter(area, () => {
        calls++
      })
      step = 'swapped'
      break

    case 'swapped':
      staleCalls = calls
      // A real entry, after the swap.
      TriggerAreaResult.addValue(area, result(TriggerAreaEventType.TAET_ENTER, 3))
      step = 'measured-stale'
      break

    case 'measured-stale':
      freshCalls = calls - staleCalls
      step = 'done'
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  area = engine.addEntity()
  player = engine.addEntity()

  engine.addSystem(driver, 0, 'repro/driver')
}
