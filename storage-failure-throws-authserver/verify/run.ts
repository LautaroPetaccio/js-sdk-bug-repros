// Headless run: starts `sdk-commands start` with no client, then drives every check in
// src/checks.ts against its storage routes over real HTTP. Exit code 1 when any check fails.
import { spawn } from 'child_process'
import { Storage } from '@dcl/sdk/server'
import { runChecks, summarize } from '../src/checks'

const PORT = process.env.PREVIEW_PORT ?? '8123'
const URL_BASE = `http://localhost:${PORT}`
process.env.PREVIEW_URL = URL_BASE

async function waitForServer(deadlineMs: number) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    try {
      const response = await fetch(`${URL_BASE}/values?limit=1`)
      if (response.status < 500) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`preview server did not answer on ${URL_BASE} within ${deadlineMs} ms`)
}

async function main() {
  // wrapSignedFetch logs every failed request; the checks report those outcomes themselves.
  if (!process.env.VERBOSE) console.error = () => {}
  const preview = spawn('npx', ['sdk-commands', 'start', '--no-client', '--no-watch', '--port', PORT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  let output = ''
  preview.stdout.on('data', (chunk) => (output += chunk))
  preview.stderr.on('data', (chunk) => (output += chunk))
  const stop = () => {
    try {
      process.kill(-preview.pid!, 'SIGTERM')
    } catch {}
  }
  process.on('exit', stop)

  try {
    await waitForServer(180_000)
  } catch (error) {
    console.error(output.slice(-3000))
    throw error
  }

  const results = await runChecks(Storage, (line) => console.log(line))
  const verdict = summarize(results)
  console.log(`\n${verdict}`)
  stop()
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
