import { Engine, Entity, IEngine, TextShape, Transform, TweenSystem, createTweenSystem, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Tween as TweenComponent, TweenState as TweenStateComponent } from '@dcl/ecs/dist/components'

// Engine ids come from Date.now(), so two engines built back to back normally
// share one. A few attempts cover a millisecond boundary landing between them.
const COLLISION_ATTEMPTS = 200
// PBTweenState.state. The enum ships as a `const enum`, which cannot be imported
// at runtime, so the two values this scene needs are spelled out.
const TS_ACTIVE = 0
const TS_COMPLETED = 1

type Phase = 'warm-up' | 'complete-tween' | 'done'

type Engines = { first: IEngine; second: IEngine; collided: boolean }

let engines: Engines
let sharedSystem = false
let secondSystem: TweenSystem
let tweenedEntity: Entity
let reported = false
let phase: Phase = 'warm-up'
let warmUpFrames = 0
let sign: Entity
let rendered = ''

/** Two engines whose numeric ids collide, which is the normal case. */
function buildCollidingEngines(): Engines {
  let first = Engine()
  let second = Engine()
  for (let attempt = 0; attempt < COLLISION_ATTEMPTS && first._id !== second._id; attempt++) {
    first = Engine()
    second = Engine()
  }
  return { first, second, collided: first._id === second._id }
}

function setUpSecondEngine() {
  const Tween = TweenComponent(engines.second)
  const TweenState = TweenStateComponent(engines.second)

  tweenedEntity = engines.second.addEntity()
  Tween.create(tweenedEntity, {
    duration: 1000,
    easingFunction: 0,
    mode: { $case: 'move', move: { start: Vector3.create(0, 0, 0), end: Vector3.create(1, 0, 0) } }
  })
  TweenState.create(tweenedEntity, { state: TS_ACTIVE, currentTime: 0 })
}

/** Marks the tween finished, the way a renderer reports it. */
function completeTween() {
  TweenStateComponent(engines.second).createOrReplace(tweenedEntity, { state: TS_COMPLETED, currentTime: 1 })
}

function driver() {
  switch (phase) {
    case 'warm-up':
      // Two frames: one for the tween system to notice the tween, one for it to
      // settle, which is what leaves it ready to report the completion.
      void engines.first.update(0.1)
      void engines.second.update(0.1)
      if (++warmUpFrames < 3) break
      phase = 'complete-tween'
      break

    case 'complete-tween':
      completeTween()
      // The scene asks before the tween system's own bookkeeping runs again,
      // which is where a scene would read it too.
      reported = secondSystem.tweenCompleted(tweenedEntity)
      phase = 'done'
      break
  }

  render()
}

function render() {
  const lines = ['tween systems shared between engines']

  lines.push(`engine ids collided: ${engines.collided ? `yes (both ${engines.first._id})` : 'no'}`)
  lines.push(`second engine got the first engine's tween system: ${sharedSystem ? 'yes' : 'no'}`)
  lines.push(
    phase === 'done'
      ? `completed tween reported to the second engine: ${reported ? 'yes' : 'no'}`
      : 'running the tween on the second engine...'
  )

  let verdict = ''
  if (phase === 'done') {
    if (!engines.collided) {
      verdict = 'INCONCLUSIVE: no two engines shared a numeric id, so the cache was never asked to collide'
    } else if (sharedSystem && !reported) {
      verdict = 'BUG REPRODUCED: the second engine shares the first engine tween system and never sees its own tween finish'
    } else if (!sharedSystem && reported) {
      verdict = 'FIXED: each engine keeps its own tween system and reports its own completions'
    } else {
      verdict = `UNEXPECTED: shared=${sharedSystem} reported=${reported}`
    }
    lines.push(verdict)
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.4,
    textColor: verdict === '' ? Color4.White() : verdict.startsWith('BUG') ? Color4.Red() : Color4.Green(),
    width: 14,
    height: 6
  })
  console.log(text)
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  engines = buildCollidingEngines()

  const firstSystem = createTweenSystem(engines.first)
  secondSystem = createTweenSystem(engines.second)
  sharedSystem = firstSystem === secondSystem

  setUpSecondEngine()
  engine.addSystem(driver, 0, 'repro/driver')
}
