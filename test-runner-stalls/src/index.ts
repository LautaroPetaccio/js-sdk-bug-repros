import { Engine, Entity, IEngine, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { createTestRuntime } from '@dcl/sdk/testing/runtime'
import type { TestingModule } from '@dcl/sdk/testing/types'

const FRAMES_BEFORE_RUN = 45
// Frames handed to each runner, well past what these tests need.
const FRAMES_PER_RUN = 12

type LoggedResult = { name: string; ok: boolean }
type Phase = 'idle' | 'running' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''

// What the two runs measured.
let yieldedThrowReported = false
let updateRejected = false
let testAfterFailureRan = false

/** Stands in for the host's `~system/Testing` module and records what it is told. */
function stubTestingModule(results: LoggedResult[]): TestingModule {
  return {
    logTestResult: async (result: LoggedResult) => {
      results.push(result)
      return {}
    },
    plan: async () => ({}),
    setCameraTransform: async () => ({})
  } as unknown as TestingModule
}

/** Runs one engine forward, remembering whether any update rejected. */
async function runFrames(probe: IEngine) {
  for (let frame = 0; frame < FRAMES_PER_RUN; frame++) {
    try {
      await probe.update(1 / 30)
    } catch {
      updateRejected = true
    }
  }
}

/** A test whose failure arrives from inside a yielded function. */
async function measureYieldedThrow() {
  const probe = Engine()
  const results: LoggedResult[] = []
  const runtime = createTestRuntime(stubTestingModule(results), probe)

  runtime.test('a yielded function throws', function* () {
    yield () => {
      throw new Error('boom')
    }
  })

  await runFrames(probe)
  yieldedThrowReported = results.some((result) => result.name === 'a yielded function throws' && !result.ok)
}

/** A test that rejects with something that is not an error, and one after it. */
async function measureThrowUndefined() {
  const probe = Engine()
  const results: LoggedResult[] = []
  const runtime = createTestRuntime(stubTestingModule(results), probe)

  runtime.test('throws undefined', function* () {
    throw undefined
  })
  runtime.test('runs after it', function* () {
    yield
  })

  await runFrames(probe)
  testAfterFailureRan = results.some((result) => result.name === 'runs after it')
}

function render() {
  const lines = ['in-scene test runner, two ways a run ends early']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`failure from a yielded function reported: ${yieldedThrowReported}`)
    lines.push(`that failure escaped into engine.update: ${updateRejected}`)
    lines.push(`test scheduled after a "throw undefined" ran: ${testAfterFailureRan}`)

    if (yieldedThrowReported && !updateRejected && testAfterFailureRan) {
      verdict = 'FIXED: both failures are reported as failures and the run carries on.'
    } else {
      verdict = 'BUG REPRODUCED: a failing test takes the run down with it instead of being reported.'
    }
    lines.push(verdict)
  } else {
    lines.push(`running the two test plans in ${FRAMES_BEFORE_RUN - frames} frames`)
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
    phase = 'running'
    void measureYieldedThrow()
      .then(measureThrowUndefined)
      .then(() => {
        phase = 'done'
      })
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
