import { Entity, TextShape, Transform, engine, timers } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Frames sampled to learn the host's frame time before anything is armed.
const SAMPLE_FRAMES = 30
// Rounds measured. Each one re-poisons the context, because the poisoned timer's
// own callback returns normally and clears it again.
const ROUNDS = 20
// Delay for every measured timer, as a fraction of one frame. The leak is bounded
// by min(interval, frame dt), so a sub-frame delay is what turns it into a whole
// extra frame instead of a rounding blip. Must stay inside (0.5, 1) of a frame:
// above 0.5 so a poisoned timer misses its first frame, below 1 so a clean one
// catches it.
const DELAY_FRAME_FRACTION = 0.7
// Floor for hosts reporting implausibly small frame times.
const MIN_DELAY_MS = 4
// Share of rounds that must fire late before the bug is called reproduced.
const LATE_ROUND_RATIO = 0.8

type Phase =
  | 'sample'
  | 'arm-baseline'
  | 'await-baseline'
  | 'arm-thrower'
  | 'await-throw'
  | 'arm-poisoned'
  | 'await-poisoned'
  | 'done'

type Measurement = { frames: number; ms: number }

// Scene clock and frame counter, accumulated from dt: deterministic, unlike the wall clock.
let clockMs = 0
let frames = 0

const samples: number[] = []
let delayMs = 0

let phase: Phase = 'sample'
let round = 0
let threw = false
let armedAtFrame = 0
let armedAtMs = 0
let rendered = ''
let sign: Entity

const baseline: Measurement[] = []
const poisoned: Measurement[] = []

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function arm(callback: () => void) {
  // Armed from a regular system, after the timers system already ran this frame.
  armedAtFrame = frames
  armedAtMs = clockMs
  timers.setTimeout(callback, delayMs)
}

function measure(into: Measurement[]) {
  // The clock system runs above the timers system, so both readings already include this frame.
  into.push({ frames: frames - armedAtFrame, ms: clockMs - armedAtMs })
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function lateRounds(): number {
  let late = 0
  for (let i = 0; i < poisoned.length; i++) {
    if (poisoned[i].frames > baseline[i].frames) late++
  }
  return late
}

function render() {
  const lines = ['timer context leak after a throwing callback']

  if (phase === 'sample') {
    lines.push(`sampling frame time... ${frames}/${SAMPLE_FRAMES} frames`)
  } else {
    lines.push(`frame time ${median(samples).toFixed(1)}ms, timer delay ${delayMs.toFixed(1)}ms`)
    lines.push(`rounds completed: ${poisoned.length}/${ROUNDS}`)
  }

  let late = 0
  if (poisoned.length > 0) {
    late = lateRounds()
    lines.push(
      `baseline timer: ${average(baseline.map((m) => m.frames)).toFixed(2)} frames, ` +
        `${average(baseline.map((m) => m.ms)).toFixed(1)}ms`
    )
    lines.push(
      `poisoned timer: ${average(poisoned.map((m) => m.frames)).toFixed(2)} frames, ` +
        `${average(poisoned.map((m) => m.ms)).toFixed(1)}ms`
    )
    lines.push(`rounds where the poisoned timer needed an extra frame: ${late}/${poisoned.length}`)
  }

  let verdict = ''
  if (phase === 'done') {
    verdict =
      late >= ROUNDS * LATE_ROUND_RATIO
        ? 'BUG REPRODUCED: a timer armed after a throwing callback loses a whole frame'
        : 'FIXED: a timer armed after a throwing callback is measured from its own arming'
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

function driver() {
  switch (phase) {
    case 'sample':
      if (frames < SAMPLE_FRAMES) break
      delayMs = Math.max(MIN_DELAY_MS, median(samples) * DELAY_FRAME_FRACTION)
      phase = 'arm-baseline'
      break

    case 'arm-baseline':
      phase = 'await-baseline'
      arm(() => {
        measure(baseline)
        phase = 'arm-thrower'
      })
      break

    case 'arm-thrower':
      phase = 'await-throw'
      threw = false
      // Fires on the next frame with accumulatedTime still 0, so the leaked accruedMs
      // is the whole interval. The flag is set before throwing: the throw aborts the
      // frame, so the driver cannot observe it any other way.
      timers.setTimeout(() => {
        threw = true
        throw new Error('deliberate failure inside a timer callback')
      }, delayMs)
      break

    case 'await-throw':
      if (!threw) break
      phase = 'arm-poisoned'
      break

    case 'arm-poisoned':
      phase = 'await-poisoned'
      arm(() => {
        measure(poisoned)
        round++
        // This callback returning normally is what clears the context, so the next
        // round starts clean.
        phase = round < ROUNDS ? 'arm-baseline' : 'done'
      })
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  // Above the timers system (Number.MAX_SAFE_INTEGER); systems run in descending
  // priority, so callbacks read a clock that already includes the current frame.
  engine.addSystem(
    (dt: number) => {
      const ms = dt * 1000
      clockMs += ms
      frames++
      if (samples.length < SAMPLE_FRAMES && ms > 0) samples.push(ms)
    },
    Number.MAX_VALUE,
    'repro/clock'
  )

  engine.addSystem(driver, 0, 'repro/driver')
}
