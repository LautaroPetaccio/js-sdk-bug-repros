import {
  AssetLoadLoadingState,
  Entity,
  LoadingState,
  TextShape,
  Transform,
  assetLoadLoadingStateSystem,
  engine
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// What the grow-only value set keeps before it starts dropping the oldest.
const STORED_VALUES = 100
// Loading events pushed after the set is already full.
const EVENTS_AFTER_CAP = 5
// Frames to let the loading system run between steps.
const SETTLE_FRAMES = 2

type Phase = 'idle' | 'filling' | 'after-cap' | 'done'

let sign: Entity
let watched: Entity
let frames = 0
let phase: Phase = 'idle'
let stepFrames = 0
let pushedAfterCap = 0
let delivered = 0
let deliveredBeforeCap = -1
let deliveredAfterCap = -1
let rendered = ''

function pushLoadingState(asset: string, timestamp: number, state: LoadingState) {
  AssetLoadLoadingState.addValue(watched, { asset, currentState: state, timestamp })
}

function render() {
  const lines = ['asset loading callbacks and the value set cap']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`delivered while the set was filling: ${deliveredBeforeCap} of ${STORED_VALUES}`)
    lines.push(`delivered after it was full: ${deliveredAfterCap} of ${EVENTS_AFTER_CAP}`)

    if (deliveredBeforeCap === STORED_VALUES && deliveredAfterCap === EVENTS_AFTER_CAP) {
      verdict = 'FIXED: the callback keeps hearing about loading events.'
    } else {
      verdict = 'BUG REPRODUCED: once the set stopped growing the callback went silent for good.'
    }
    lines.push(verdict)
  } else if (phase === 'idle') {
    lines.push('filling the loading state set...')
  } else {
    lines.push(`delivered so far: ${delivered}`)
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
      // Fill the set to its cap, the way a scene loading many assets would.
      for (let index = 1; index <= STORED_VALUES; index++) {
        pushLoadingState(`asset-${index}`, index, LoadingState.LOADING)
      }
      phase = 'filling'
      stepFrames = 0
      break

    case 'filling':
      if (++stepFrames >= SETTLE_FRAMES) {
        deliveredBeforeCap = delivered
        phase = 'after-cap'
        stepFrames = 0
      }
      break

    case 'after-cap':
      // Everything from here evicts an older value instead of growing the set.
      if (pushedAfterCap < EVENTS_AFTER_CAP) {
        pushedAfterCap++
        pushLoadingState(`after-cap-${pushedAfterCap}`, STORED_VALUES + pushedAfterCap, LoadingState.FINISHED)
      } else if (++stepFrames >= SETTLE_FRAMES) {
        deliveredAfterCap = delivered - deliveredBeforeCap
        phase = 'done'
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  watched = engine.addEntity()
  assetLoadLoadingStateSystem.registerAssetLoadLoadingStateEntity(watched, () => {
    delivered++
  })

  engine.addSystem(driver, 0, 'repro/driver')
}
