import { Entity, TextShape, Transform, engine, timers } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Delay requested from every measured timer in this scene.
const REQUESTED_MS = 1000
// A single frame long enough to swallow REQUESTED_MS whole, which maximises the leaked accruedMs.
const LONG_FRAME_MS = 1200
// Drift above this is reported as late.
const TOLERANCE_MS = 50

type Phase =
  | 'arm-baseline'
  | 'await-baseline'
  | 'arm-thrower'
  | 'arm-poisoned'
  | 'await-poisoned'
  | 'arm-recovery'
  | 'await-recovery'
  | 'done'

type Row = { label: string; measured: number }

// Scene clock accumulated from dt: deterministic, unlike the wall clock.
let clockMs = 0
// Frames seen by the clock system vs frames the driver reached; they diverge on the aborted frame.
let frames = 0
let driverFrames = 0

let phase: Phase = 'arm-baseline'
let armedAtMs = 0
let rendered = ''
let sign: Entity

const rows: Row[] = []

function arm(label: string, callback: () => void) {
  // Armed from a regular system, after the timers system already ran this frame.
  armedAtMs = clockMs
  console.log(`[timer-repro] arm ${label}: ${REQUESTED_MS}ms at t=${Math.round(clockMs)}ms`)
  timers.setTimeout(callback, REQUESTED_MS)
}

function measure(label: string) {
  // The clock system already added this frame's dt, so the reading is sub-frame accurate.
  rows.push({ label, measured: clockMs - armedAtMs })
}

function busyWait(ms: number) {
  // Deliberate stall so the next frame reports a dt that covers REQUESTED_MS in one step.
  const until = Date.now() + ms
  while (Date.now() < until) {}
}

function signed(ms: number): string {
  return `${ms >= 0 ? '+' : ''}${Math.round(ms)}ms`
}

function render() {
  const lines = ['timer context leak after a throwing callback']

  for (const row of rows) {
    lines.push(
      `${row.label}: requested ${REQUESTED_MS}ms, measured ${Math.round(row.measured)}ms, delta ${signed(
        row.measured - REQUESTED_MS
      )}`
    )
  }

  let drift = 0
  if (rows.length < 3) {
    lines.push(`measuring... t=${Math.round(clockMs)}ms`)
  } else {
    drift = rows[1].measured - REQUESTED_MS
    lines.push(
      drift > TOLERANCE_MS
        ? `BUG REPRODUCED: the poisoned timer fired ${Math.round(drift)}ms late`
        : 'FIXED: every timer fired on time'
    )
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.4,
    textColor: drift > TOLERANCE_MS ? Color4.Red() : rows.length < 3 ? Color4.White() : Color4.Green(),
    width: 14,
    height: 6
  })
  console.log(text)
}

function driver() {
  // A frame the driver never reached is the frame the throwing callback aborted.
  const abortedFrame = frames > driverFrames + 1
  driverFrames = frames

  switch (phase) {
    case 'arm-baseline':
      phase = 'await-baseline'
      arm('baseline', () => {
        measure('1 baseline (clean context)')
        phase = 'arm-thrower'
      })
      break

    case 'arm-thrower':
      phase = 'arm-poisoned'
      console.log(`[timer-repro] arm thrower: ${REQUESTED_MS}ms, then stall ${LONG_FRAME_MS}ms`)
      // Fires on the next frame with accumulatedTime still 0, so accruedMs lands at the full interval.
      timers.setTimeout(() => {
        console.log('[timer-repro] throwing from inside a timer callback')
        throw new Error('deliberate failure inside a timer callback')
      }, REQUESTED_MS)
      busyWait(LONG_FRAME_MS)
      break

    case 'arm-poisoned':
      // Wait for the throw to actually abort a frame, otherwise the context is not stale yet.
      if (!abortedFrame) break
      console.log('[timer-repro] the throwing callback aborted a frame; arming the next timer now')
      phase = 'await-poisoned'
      arm('poisoned', () => {
        measure('2 poisoned (armed after the throw)')
        phase = 'arm-recovery'
      })
      break

    case 'arm-recovery':
      phase = 'await-recovery'
      arm('recovered', () => {
        measure('3 recovered (armed after a clean fire)')
        phase = 'done'
      })
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  // Above the timers system (Number.MAX_SAFE_INTEGER) so callbacks read a clock that includes this frame.
  engine.addSystem(
    (dt: number) => {
      clockMs += dt * 1000
      frames++
    },
    Number.MAX_VALUE,
    'repro/clock'
  )

  engine.addSystem(driver, undefined, 'repro/driver')
}
