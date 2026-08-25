/**
 * Scene readout for the `@dcl/sdk/players` conformance matrix. The checks themselves live in
 * `checks.ts`, which imports nothing from the scene runtime so the same implementation can be
 * run headlessly — see `verify/` and the README's measured output.
 */
import { Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { checks, script, verdict } from './checks'

// ── Readout ──


let sign: Entity
let rendered = ''
let steps: Generator<void, void, void>
let finished = false

function render() {
  const lines = ['@dcl/sdk/players conformance (js-sdk-toolchain#1512)', '']
  for (const c of checks) {
    const mark = c.status === 'PASS' ? '+' : c.status === 'FAIL' ? 'x' : '-'
    lines.push(`${mark} ${c.id} — ${c.detail}`)
  }
  if (!finished) {
    lines.push('', 'running...')
  } else {
    lines.push('', verdict().text)
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 0.7,
    textColor: finished ? (verdict().failed > 0 ? Color4.Red() : Color4.Green()) : Color4.White(),
    width: 22,
    height: 16
  })
  console.log(text)
}

function driver() {
  if (!finished) {
    const next = steps.next()
    if (next.done) finished = true
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 3, 8) })

  steps = script()
  engine.addSystem(driver, 0, 'repro/driver')
}
