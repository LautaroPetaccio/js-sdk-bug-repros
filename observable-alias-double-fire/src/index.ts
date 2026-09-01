import { AvatarBase, Entity, PlayerIdentityData, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { onEnterSceneObservable, onPlayerConnectedObservable } from '@dcl/sdk/observables'

// Frames to let the observables install their listeners before a player shows up.
const FRAMES_BEFORE_JOIN = 30
// Frames to let the players helper notice the join and the callbacks run.
const FRAMES_AFTER_JOIN = 5

const FAKE_PLAYER = '0x0000000000000000000000000000000000000001'

let sign: Entity
let frames = 0
let joined = false
let reported = false
let rendered = ''

// Two names for the same thing. A scene subscribing to both is the case that
// breaks; one alone behaves correctly on any build.
let enterSceneCalls = 0
let playerConnectedCalls = 0
onEnterSceneObservable.add(() => {
  enterSceneCalls++
})
onPlayerConnectedObservable.add(() => {
  playerConnectedCalls++
})

/**
 * A player, as far as the SDK is concerned, is an entity carrying identity and
 * avatar data. Creating one is what a real join looks like from in here.
 */
function synthesiseJoin() {
  const player = engine.addEntity()
  PlayerIdentityData.create(player, { address: FAKE_PLAYER, isGuest: true })
  AvatarBase.create(player, {
    name: 'test player',
    skinColor: Color4.create(1, 1, 1, 1),
    eyesColor: Color4.create(0, 0, 0, 1),
    hairColor: Color4.create(0, 0, 0, 1),
    bodyShapeUrn: 'urn:decentraland:off-chain:base-avatars:BaseMale'
  })
}

function render() {
  const lines = ['two observables, one underlying subscription']

  let verdict = ''
  if (reported) {
    lines.push('one player joined')
    lines.push(`onEnterSceneObservable notified: ${enterSceneCalls} time(s)`)
    lines.push(`onPlayerConnectedObservable notified: ${playerConnectedCalls} time(s)`)

    if (enterSceneCalls === 1 && playerConnectedCalls === 1) {
      verdict = 'FIXED: one join, one notification each.'
    } else {
      verdict = 'BUG REPRODUCED: the listener was installed once per name, so every observer runs once per copy.'
    }
    lines.push(verdict)
  } else {
    lines.push(joined ? 'counting...' : `a player joins in ${FRAMES_BEFORE_JOIN - frames} frames`)
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

  if (!joined && frames >= FRAMES_BEFORE_JOIN) {
    synthesiseJoin()
    joined = true
  } else if (joined && !reported && frames >= FRAMES_BEFORE_JOIN + FRAMES_AFTER_JOIN) {
    reported = true
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
