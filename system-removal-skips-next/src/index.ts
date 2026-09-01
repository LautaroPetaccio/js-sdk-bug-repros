import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const FRAMES_BEFORE_RUN = 45

type Phase = 'idle' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let firstTick: string[] = []
let secondTick: string[] = []
let rendered = ''

/**
 * Three systems at descending priorities. The first removes itself, which is
 * the documented way to write a one-shot system and what @dcl/sdk's own sleep
 * helper does.
 */
async function measure() {
  const probe = Engine()
  const ran: string[] = []

  const oneShot = () => {
    ran.push('one-shot')
    probe.removeSystem(oneShot)
  }
  probe.addSystem(oneShot, 300, 'one-shot')
  probe.addSystem(() => ran.push('second'), 200, 'second')
  probe.addSystem(() => ran.push('third'), 100, 'third')

  await probe.update(1 / 30)
  firstTick = [...ran]

  ran.length = 0
  await probe.update(1 / 30)
  secondTick = [...ran]
}

function render() {
  const lines = ['a one-shot system and the systems after it']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`ran on the tick it removed itself: ${firstTick.join(', ') || 'nothing'}`)
    lines.push(`ran on the next tick: ${secondTick.join(', ') || 'nothing'}`)

    const firstTickComplete = firstTick.join(',') === 'one-shot,second,third'
    const secondTickComplete = secondTick.join(',') === 'second,third'

    if (firstTickComplete && secondTickComplete) {
      verdict = 'FIXED: removing a system leaves the others running.'
    } else if (!firstTickComplete) {
      verdict = 'BUG REPRODUCED: a system was skipped on the tick the one-shot removed itself.'
    } else {
      verdict = `UNEXPECTED: second tick ran ${secondTick.join(', ')}`
    }
    lines.push(verdict)
  } else {
    lines.push(`running the systems in ${FRAMES_BEFORE_RUN - frames} frames`)
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
    void measure().then(() => {
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
