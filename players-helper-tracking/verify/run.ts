/**
 * Headless runner for the conformance matrix.
 *
 * Bundled with esbuild (see `npm run verify`) because `@dcl/ecs` ships directory imports that
 * Node's ESM resolver rejects, and run under plain Node: every check drives its own `Engine()`,
 * so nothing here needs the scene runtime, a renderer, or a second peer. This is what produces
 * the numbers quoted in the README.
 */
import { installRejectionHook, noteEscapedRejection, runAll, verdict } from '../src/checks'

// The pre-#1512 helper lets an async handler's rejection escape, which under Node's default
// unhandled-rejection policy terminates the process mid-matrix. Capturing it keeps the run
// going AND is the measurement for `isolation/async-rejection-contained`.
installRejectionHook()
process.on('unhandledRejection', (reason) => {
  noteEscapedRejection()
  console.log(`  (captured escaped rejection: ${(reason as Error)?.message ?? reason})`)
})

async function report() {
  const results = await runAll()
  for (const c of results) {
    const mark = c.status === 'PASS' ? '+' : c.status === 'FAIL' ? 'x' : '-'
    console.log(`${mark} ${c.id.padEnd(38)} ${c.detail}`)
  }
  const v = verdict()
  console.log('')
  console.log(v.text)
  console.log(`pass=${v.passed} fail=${v.failed} n/a=${v.na} total=${results.length}`)
}

void report()
