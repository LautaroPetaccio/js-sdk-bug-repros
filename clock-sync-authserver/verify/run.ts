// Headless run: an authoritative server and a client, each a real copy of the scene runtime in its own vm context
// with its own clock, joined by a simulated network that only hands messages over on tick boundaries, the way
// sendBinary does. Every check drives the public @dcl/sdk/network API. Exit code 1 when any check fails.
import fs from 'fs'
import path from 'path'
import vm from 'vm'

const BUNDLE = fs.readFileSync(path.join(__dirname, 'instance.bundle.js'), 'utf8')
const SERVER_ID = 'authoritative-server'
const CLIENT_ID = '0x1111111111111111111111111111111111111111'
const SERVER_TICK_MS = 30
const CLIENT_TICK_MS = 16
const JOIN_AT_MS = 200
const CUSTOM_EVENT = 6
const PONG = Buffer.from('__sdkClockPong')

type Scene = {
  update(dt: number): Promise<void>
  setConnected(connected: boolean): void
  getServerTime(): number | undefined
  getClockSyncStats(): { frozen: boolean } | undefined
  freezeServerClock(frozen: boolean): void
  getPlayerLatency(userId: string): number | undefined
  rejectsReservedName(): boolean
}

type Leg = (from: Participant, to: Participant, bytes: Uint8Array) => number

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function frame(sender: string, bytes: Uint8Array) {
  const name = Buffer.from(sender, 'utf8')
  const out = new Uint8Array(1 + name.length + bytes.length)
  out[0] = name.length
  out.set(name, 1)
  out.set(bytes, 1 + name.length)
  return out
}

const isPong = (bytes: Uint8Array) => bytes[0] === CUSTOM_EVENT && Buffer.from(bytes).includes(PONG)

class Sim {
  now = 0
  participants: Participant[] = []
  private lastOnLink = new Map<string, number>()
  readonly console = {
    log() {},
    info() {},
    debug() {},
    warn() {},
    error: (...args: unknown[]) => process.env.VERBOSE && console.error(...args)
  }

  constructor(private readonly leg: Leg) {}

  route(from: Participant, bytes: Uint8Array, address: string[]) {
    // In an authoritative scene the explorer sends every client message to the server, whatever the address.
    const recipients = from.isServer
      ? this.participants.filter(
          (p) => !p.isServer && (!address.length || address.some((a) => a.toLowerCase() === p.id.toLowerCase()))
        )
      : this.participants.filter((p) => p.isServer)
    for (const to of recipients) {
      const link = `${from.id}>${to.id}`
      const at = Math.max(this.now + this.leg(from, to, bytes), this.lastOnLink.get(link) ?? 0)
      this.lastOnLink.set(link, at)
      to.inbox.push({ at, bytes: frame(from.id, bytes) })
    }
  }
}

class Participant {
  inbox: { at: number; bytes: Uint8Array }[] = []
  next = 0
  readonly scene: Scene
  private readonly ContextUint8Array: Uint8ArrayConstructor

  constructor(
    private readonly sim: Sim,
    readonly id: string,
    readonly isServer: boolean,
    readonly tickMs: number,
    public wallOffset: number,
    withPerformance: boolean
  ) {
    const host = {
      sendBinary: async (request: { peerData: { data: Uint8Array[]; address: string[] }[] }) => {
        for (const message of request.peerData) {
          for (const data of message.data) sim.route(this, Uint8Array.from(data), message.address)
        }
        return { data: this.drain() }
      },
      isServer: async () => ({ isServer }),
      getUserData: async () => ({
        data: { userId: id, displayName: 'repro', publicKey: id, hasConnectedWeb3: true, version: 1 }
      })
    }
    const context = vm.createContext({
      console: sim.console,
      TextEncoder,
      TextDecoder,
      __host: host,
      __wall: () => sim.now + this.wallOffset,
      __mono: () => sim.now + 12_345.678
    })
    vm.runInContext(
      `{ const RealDate = Date
         globalThis.Date = class extends RealDate {
           constructor(...args) { args.length ? super(...args) : super(__wall()) }
           static now() { return __wall() }
         } }` + (withPerformance ? '\nglobalThis.performance = { now: () => __mono() }' : ''),
      context
    )
    vm.runInContext(BUNDLE, context)
    this.scene = (context as any).__scene
    this.ContextUint8Array = vm.runInContext('Uint8Array', context)
  }

  wall() {
    return this.sim.now + this.wallOffset
  }

  private drain() {
    const ready = this.inbox.filter((m) => m.at <= this.sim.now)
    this.inbox = this.inbox.filter((m) => m.at > this.sim.now)
    return ready.map((m) => new this.ContextUint8Array(m.bytes))
  }
}

type Sample = { t: number; server: number | undefined; truth: number; local: number }

type Run = {
  durationMs: number
  serverTickMs?: number
  seed?: number
  withPerformance?: boolean
  leg?: (random: () => number) => Leg
  onTick?: (t: number, client: Participant) => void
  reads?: (t: number) => boolean
}

const steadyLeg =
  (r: () => number): Leg =>
  () =>
    40 + r() * 20

async function simulate(run: Run) {
  const r = random(run.seed ?? 7)
  const sim = new Sim((run.leg ?? steadyLeg)(r))
  const server = new Participant(sim, SERVER_ID, true, run.serverTickMs ?? SERVER_TICK_MS, 1_700_000_000_000, true)
  const client = new Participant(sim, CLIENT_ID, false, CLIENT_TICK_MS, 1_700_000_004_321, run.withPerformance ?? true)
  sim.participants = [server, client]
  server.scene.setConnected(true)
  client.next = JOIN_AT_MS
  let joined = false
  const samples: Sample[] = []
  for (;;) {
    const p = server.next <= client.next ? server : client
    if (p.next > run.durationMs) break
    sim.now = p.next
    if (p === client) {
      if (!joined) client.scene.setConnected((joined = true))
      run.onTick?.(sim.now, client)
    }
    await p.scene.update(p.tickMs / 1000)
    if (p === client && (run.reads?.(sim.now) ?? true)) {
      samples.push({
        t: sim.now,
        server: client.scene.getServerTime(),
        truth: sim.now + server.wallOffset,
        local: client.wall()
      })
    }
    p.next += p.tickMs
  }
  return { samples, server, client }
}

const error = (s: Sample) => s.server! - s.truth
const offset = (s: Sample) => s.server! - s.local
const defined = (samples: Sample[], from = 0, to = Infinity) =>
  samples.filter((s) => s.t >= from && s.t < to && s.server !== undefined)
const firstDefinedAt = (samples: Sample[], from = 0) => defined(samples, from)[0]?.t ?? Infinity

/** How long after `from` the error drops under `threshold` and stays there for 10 s. */
function settleMs(samples: Sample[], from: number, threshold: number) {
  const xs = samples.filter((s) => s.t >= from)
  for (let i = 0; i < xs.length; i++) {
    let holds = true
    for (let j = i; j < xs.length && xs[j].t < xs[i].t + 10_000; j++) {
      if (xs[j].server === undefined || Math.abs(error(xs[j])) >= threshold) {
        holds = false
        break
      }
    }
    if (holds) return xs[i].t - from
  }
  return Infinity
}

function motion(samples: Sample[], from = 0, to = Infinity) {
  const xs = defined(samples, from, to)
  let backwardsMs = 0
  let longestStillMs = 0
  let still = 0
  for (let i = 1; i < xs.length; i++) {
    const step = xs[i].server! - xs[i - 1].server!
    if (step < 0) backwardsMs = Math.max(backwardsMs, -step)
    still = step === 0 ? still + (xs[i].t - xs[i - 1].t) : 0
    longestStillMs = Math.max(longestStillMs, still)
  }
  return { backwardsMs, longestStillMs }
}

function spread(values: number[]) {
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

const ms = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'never')

type Check = { name: string; pass: boolean; got: string }

async function runChecks(log: (line: string) => void): Promise<Check[]> {
  const checks: Check[] = []
  const check = (name: string, pass: boolean, got: string) => {
    checks.push({ name, pass, got })
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${got})`)
  }

  {
    const { samples, server } = await simulate({ durationMs: 60_000 })
    const joinedIn = firstDefinedAt(samples) - JOIN_AT_MS
    check('syncs within 5 s of joining', joinedIn < 5_000, ms(joinedIn))
    const { backwardsMs, longestStillMs } = motion(samples)
    check('the server time never runs backwards', backwardsMs === 0, `worst step back ${ms(backwardsMs)}`)
    check('the server time never stands still', longestStillMs === 0, `longest stall ${ms(longestStillMs)}`)
    const latency = server.scene.getPlayerLatency(CLIENT_ID)
    check(
      'getPlayerLatency reads the round trip plus at most the tick waits (90-170 ms on a 100 ms link)',
      latency !== undefined && latency >= 90 && latency <= 170,
      latency === undefined ? 'undefined' : ms(latency)
    )
  }

  {
    // A slow server tick makes the server's hold before the pong leaves large enough to show as a bias.
    const biases: number[] = []
    for (const seed of [7, 11, 13]) {
      const { samples } = await simulate({ durationMs: 60_000, serverTickMs: 100, seed })
      const steady = defined(samples, 20_000).map(error)
      biases.push(steady.reduce((a, b) => a + b, 0) / steady.length)
    }
    const worst = biases.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))
    check(
      'no bias against the server clock: mean error under 20 ms with a 100 ms server tick',
      Math.abs(worst) < 20,
      `worst of 3 seeds ${ms(worst)}`
    )
  }

  // The return leg slows by 100 ms from 25 s, so the live estimate moves by 50 ms while frozen.
  const slowDownAfter =
    (t0: number, sim: { now: number }) =>
    (r: () => number): Leg =>
    (_from, to) =>
      40 + r() * 20 + (!to.isServer && sim.now >= t0 ? 100 : 0)

  {
    const clock = { now: 0 }
    const { samples } = await simulate({
      durationMs: 50_000,
      leg: slowDownAfter(25_000, clock),
      onTick: (t, client) => {
        clock.now = t
        if (t >= 20_000 && t < 40_000) client.scene.freezeServerClock(true)
        else if (t >= 40_000 && t < 40_000 + CLIENT_TICK_MS) client.scene.freezeServerClock(false)
      }
    })
    const held = spread(defined(samples, 20_100, 40_000).map(offset))
    check('freezeServerClock(true) called every frame holds the clock', held < 0.5, `moved ${ms(held)} while frozen`)
    const after = defined(samples, 39_984, 45_000)
    let worst = 0
    for (let i = 1; i < after.length; i++) worst = Math.max(worst, Math.abs(offset(after[i]) - offset(after[i - 1])))
    check(
      'unfreezing slews to the new estimate instead of jumping',
      worst < 2,
      `largest frame-to-frame change ${ms(worst)}`
    )
  }

  {
    const clock = { now: 0 }
    const { samples, client } = await simulate({
      durationMs: 30_000,
      leg: slowDownAfter(10_000, clock),
      onTick: (t, c) => {
        clock.now = t
        if (t === JOIN_AT_MS) c.scene.freezeServerClock(true)
      }
    })
    const held = spread(defined(samples).map(offset))
    const frozen = client.scene.getClockSyncStats()?.frozen === true
    check(
      'a freeze requested before the first reply holds the first estimate',
      held < 0.5 && frozen,
      `moved ${ms(held)}, stats.frozen ${frozen}`
    )
  }

  {
    const clock = { now: 0 }
    const { samples } = await simulate({
      durationMs: 45_000,
      leg: slowDownAfter(25_000, clock),
      onTick: (t, client) => {
        clock.now = t
        if (t >= 20_000 && t < 20_000 + CLIENT_TICK_MS) client.scene.freezeServerClock(true)
        if (t >= 40_000 && t < 40_000 + CLIENT_TICK_MS) client.scene.freezeServerClock(false)
      },
      reads: (t) => t < 20_000 || t >= 40_000
    })
    const before = defined(samples, 0, 20_000).pop()!
    const after = defined(samples, 40_000)[0]
    const jump = Math.abs(offset(after) - offset(before))
    check('unfreezing after 20 s without reading the clock does not jump', jump < 2, `jumped ${ms(jump)}`)
  }

  {
    const { samples } = await simulate({ durationMs: 30_000, leg: (r) => () => 800 + r() * 20 })
    const joinedIn = firstDefinedAt(samples) - JOIN_AT_MS
    check('syncs over a link slower than the ping interval (1.6 s round trip)', joinedIn < 15_000, ms(joinedIn))
  }

  {
    const sim = new Sim(() => 0)
    const client = new Participant(sim, CLIENT_ID, false, CLIENT_TICK_MS, 0, true)
    const rejected = client.scene.rejectsReservedName()
    check('registerMessages rejects the reserved __sdkClockPing name', rejected, rejected ? 'threw' : 'accepted')
  }

  {
    const { samples } = await simulate({
      durationMs: 45_000,
      onTick: (t, client) => {
        if (t >= 30_000 && t < 30_000 + CLIENT_TICK_MS) client.scene.setConnected(false)
        if (t >= 32_000 && t < 32_000 + CLIENT_TICK_MS) client.scene.setConnected(true)
      }
    })
    const right = samples.find((s) => s.t >= 30_000 + CLIENT_TICK_MS)
    check(
      'disconnecting forgets the estimate',
      right?.server === undefined,
      right?.server === undefined ? 'undefined' : 'kept the old estimate'
    )
    const again = firstDefinedAt(samples, 32_000) - 32_000
    check('reconnecting syncs again within 5 s', again < 5_000, ms(again))
  }

  {
    let delayed = false
    const { samples } = await simulate({
      durationMs: 30_000,
      leg: (r) => (from, _to, bytes) => {
        const base = 40 + r() * 20
        if (from.isServer && !delayed && isPong(bytes)) {
          delayed = true
          return base + 1_200
        }
        return base
      }
    })
    const first = firstDefinedAt(samples)
    const firstError = Math.abs(error(samples.find((s) => s.t === first)!))
    const settled = settleMs(samples, first, 20)
    check(
      'a first reply delayed 1.2 s on its way back is corrected within 3 s',
      settled < 3_000,
      `first error ${ms(firstError)}, within 20 ms after ${ms(settled)}`
    )
  }

  for (const step of [-3_000, 3_000]) {
    const { samples } = await simulate({
      durationMs: 60_000,
      withPerformance: false,
      onTick: (t, client) => {
        if (t >= 30_000 && t < 30_000 + CLIENT_TICK_MS) client.wallOffset += step
      }
    })
    const settled = settleMs(samples, 30_000, 20)
    const limit = step < 0 ? 5_000 : 8_000
    const direction = step < 0 ? 'back' : 'forward'
    check(
      `a 3 s local clock step ${direction} (no performance.now) is recovered within ${limit / 1000} s`,
      settled < limit,
      ms(settled)
    )
    if (step > 0) {
      const { backwardsMs, longestStillMs } = motion(samples, 30_000)
      check(
        'and the server time keeps running while it recovers',
        longestStillMs === 0,
        `longest stall ${ms(longestStillMs)}`
      )
      check('and never runs backwards', backwardsMs === 0, `worst step back ${ms(backwardsMs)}`)
    }
  }

  return checks
}

function summarize(checks: Check[]) {
  const failed = checks.filter((c) => !c.pass).length
  return failed === 0
    ? `FIXED: all ${checks.length} checks pass`
    : `BUG REPRODUCED: ${failed} of ${checks.length} checks fail`
}

runChecks((line) => console.log(line))
  .then((checks) => {
    console.log(`\n${summarize(checks)}`)
    process.exit(checks.every((c) => c.pass) ? 0 : 1)
  })
  .catch((err) => {
    console.error(err)
    process.exit(2)
  })
