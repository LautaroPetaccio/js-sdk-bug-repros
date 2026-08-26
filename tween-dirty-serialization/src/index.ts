import {
  Entity,
  Material,
  MeshRenderer,
  TextShape,
  Transform,
  Tween,
  TweenSequence,
  TweenState,
  TweenLoop,
  createTweenSystem,
  engine
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Active tweens held for the whole run. The cache system touches every one each frame.
const TWEENED = 300
// Of those, how many also carry a sequence, so sequence advancement is exercised too.
const SEQUENCED = 20
// Frames measured before reporting. Excludes a warm-up so JIT settling is not counted.
const WARMUP_FRAMES = 30
const MEASURED_FRAMES = 240

const tweenSystem = createTweenSystem(engine)

const tweened: Entity[] = []
let frame = 0
let totalMs = 0
let worstMs = 0
let completions = 0
let frameStart = 0
let reported = false
let sign: Entity

function tweenOrigin(index: number) {
  return Vector3.create(2 + (index % 12) * 1.2, 0.5, 2 + Math.floor(index / 12) * 1.2)
}

function makeTween(index: number) {
  const start = tweenOrigin(index)
  return {
    duration: 900 + (index % 7) * 40,
    easingFunction: 0,
    mode: Tween.Mode.Move({ start, end: Vector3.create(start.x, 2.5, start.z) })
  }
}

function report() {
  const sequencesLeft = tweened.reduce((n, e) => n + (TweenSequence.getOrNull(e)?.sequence.length ?? 0), 0)
  const moved = tweened.filter((e) => (Transform.getOrNull(e)?.position.y ?? 0) > 0.5).length
  // Tweens are executed by the renderer: it moves the Transform and writes TweenState back.
  // Without that there is nothing to complete, so absence of TweenState is not a failure.
  const driven = tweened.some((e) => TweenState.getOrNull(e) !== null)

  const verdict = !driven
    ? 'NO RENDERER DRIVING TWEENS: run this in an Explorer, not a headless harness'
    : completions > 0 && moved > 0
      ? 'BEHAVIOUR OK: tweens ran and completed'
      : 'BEHAVIOUR BROKEN: see counts above'

  const lines = [
    'tween dirty serialization',
    `active tweens: ${TWEENED} (${SEQUENCED} sequenced)`,
    `avg frame: ${(totalMs / MEASURED_FRAMES).toFixed(2)} ms   worst: ${worstMs.toFixed(2)} ms`,
    `tween completions observed: ${completions}`,
    `sequence steps still queued: ${sequencesLeft}`,
    `entities moved by their tween: ${moved}/${TWEENED}`,
    verdict
  ]
  const text = lines.join('\n')
  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.6,
    textColor: !driven ? Color4.White() : completions > 0 && moved > 0 ? Color4.Green() : Color4.Red()
  })
  console.log(text)
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 4, 8) })

  for (let i = 0; i < TWEENED; i++) {
    const entity = engine.addEntity()
    const spec = makeTween(i)
    Transform.create(entity, { position: tweenOrigin(i), scale: Vector3.create(0.3, 0.3, 0.3) })
    MeshRenderer.setBox(entity)
    Material.setPbrMaterial(entity, { albedoColor: Color4.create(0.2, 0.6, 1, 1) })
    Tween.create(entity, spec)
    if (i < SEQUENCED) {
      TweenSequence.create(entity, { sequence: [makeTween(i + 1), makeTween(i + 2)], loop: TweenLoop.TL_RESTART })
    }
    tweened.push(entity)
  }

  // Highest priority: runs before the tween systems, so it stamps the frame's start.
  engine.addSystem(
    () => {
      frameStart = Date.now()
    },
    Number.MAX_VALUE,
    'repro/clock-start'
  )

  // Lowest priority: runs after them, so the delta covers the tween work.
  engine.addSystem(
    () => {
      const elapsed = Date.now() - frameStart
      frame++

      for (const entity of tweened) {
        if (tweenSystem.tweenCompleted(entity)) completions++
      }

      if (frame > WARMUP_FRAMES && frame <= WARMUP_FRAMES + MEASURED_FRAMES) {
        totalMs += elapsed
        if (elapsed > worstMs) worstMs = elapsed
      }

      if (frame === WARMUP_FRAMES + MEASURED_FRAMES && !reported) {
        reported = true
        report()
      }
    },
    Number.MIN_SAFE_INTEGER,
    'repro/clock-end'
  )
}
