import { engine, Entity, TextShape, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import type { CheckResult } from './checks'
import { room } from './messages'

// The server runs every check against the storage service it reaches and sends the results to
// the client that asked, which shows them on a sign. Server logs: `npm run server-logs`.

export async function main() {
  if (isServer()) {
    const [{ Storage }, { runChecks, summarize }] = await Promise.all([import('@dcl/sdk/server'), import('./checks')])
    let running: Promise<CheckResult[]> | undefined
    room.onMessage('runChecks', async (_data, context) => {
      running ??= runChecks(Storage, (line) => console.log(`[storage-repro] ${line}`)).finally(() => (running = undefined))
      const results = await running
      console.log(`[storage-repro] ${summarize(results)}`)
      await room.send('report', { json: JSON.stringify(results) }, context?.from ? { to: [context.from] } : undefined)
    })
    return
  }

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 4, 8) })
  show(sign, 'Running storage checks on the authoritative server…', Color4.White())

  let received = false
  room.onMessage('report', ({ json }) => {
    received = true
    const results = JSON.parse(json) as CheckResult[]
    const failed = results.filter((r) => !r.pass)
    const verdict = failed.length === 0 ? `FIXED: all ${results.length} checks pass` : `BUG REPRODUCED: ${failed.length} of ${results.length} checks fail`
    const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `\n        expected ${r.expected}, ${r.got}`}`)
    console.log([verdict, ...lines].join('\n'))
    show(sign, [verdict, '', ...lines].join('\n'), failed.length === 0 ? Color4.Green() : Color4.Red())
  })

  // Ask until the room is up and the server answers; the suite takes a few seconds.
  let waited = 0
  engine.addSystem((dt) => {
    if (received) return
    waited += dt
    if (waited < 5) return
    waited = 0
    if (room.isReady()) void room.send('runChecks', {})
  })
}

function show(sign: Entity, text: string, color: Color4) {
  TextShape.createOrReplace(sign, { text, fontSize: 1.2, textColor: color, width: 14, textWrapping: true })
}
