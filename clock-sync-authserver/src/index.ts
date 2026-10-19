import { engine, Entity, PlayerIdentityData, TextShape, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { freezeServerClock, getClockSyncStats, getPlayerLatency, getServerTime, isServer } from '@dcl/sdk/network'

// Open two preview windows side by side: both counters should tick in step. Ten seconds after syncing the
// client freezes the clock for ten seconds (calling freezeServerClock every frame, as a scene would) and then
// releases it, checking the whole time that the clock never stalls, runs backwards or jumps.
// Server logs, with each player's latency: `npm run server-logs`.

const FREEZE_AFTER_MS = 10_000
const FREEZE_FOR_MS = 10_000
const SETTLE_MS = 5_000

export function main() {
  if (isServer()) {
    let sinceLog = 0
    engine.addSystem((dt) => {
      sinceLog += dt
      if (sinceLog < 2) return
      sinceLog = 0
      for (const [, player] of engine.getEntitiesWith(PlayerIdentityData)) {
        console.log(
          `[clock-sync-repro] latency ${player.address} ${getPlayerLatency(player.address) ?? 'not measured yet'}`
        )
      }
    })
    return
  }

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 3, 8) })
  show(sign, 'Waiting for the first clock reply…', Color4.White())

  let syncedAt: number | undefined
  let last: number | undefined
  let backwardsMs = 0
  let stallMs = 0
  let longestStallMs = 0
  let frozenOffsets: number[] = []
  let releaseJumpMs = 0
  let lastOffset: number | undefined
  let verdict: string | undefined

  engine.addSystem((dt) => {
    const now = getServerTime()
    const stats = getClockSyncStats()
    if (now === undefined || !stats) return
    syncedAt ??= Date.now()
    const elapsed = Date.now() - syncedAt
    const freezing = elapsed >= FREEZE_AFTER_MS && elapsed < FREEZE_AFTER_MS + FREEZE_FOR_MS
    freezeServerClock(freezing)

    if (last !== undefined) {
      if (now < last) backwardsMs = Math.max(backwardsMs, last - now)
      stallMs = now === last ? stallMs + dt * 1000 : 0
      longestStallMs = Math.max(longestStallMs, stallMs)
    }
    last = now
    const offset = now - Date.now()
    if (freezing && elapsed > FREEZE_AFTER_MS + 100) frozenOffsets.push(offset)
    const settling = elapsed >= FREEZE_AFTER_MS + FREEZE_FOR_MS && elapsed < FREEZE_AFTER_MS + FREEZE_FOR_MS + SETTLE_MS
    if (settling && lastOffset !== undefined) releaseJumpMs = Math.max(releaseJumpMs, Math.abs(offset - lastOffset))
    lastOffset = offset

    if (!verdict && elapsed >= FREEZE_AFTER_MS + FREEZE_FOR_MS + SETTLE_MS) {
      const held = frozenOffsets.length ? Math.max(...frozenOffsets) - Math.min(...frozenOffsets) : 0
      const failures = [
        backwardsMs > 0 && `ran backwards by ${backwardsMs.toFixed(1)} ms`,
        longestStallMs > 0 && `stood still for ${longestStallMs.toFixed(0)} ms`,
        held >= 0.5 && `moved ${held.toFixed(1)} ms while frozen`,
        releaseJumpMs >= 2 && `jumped ${releaseJumpMs.toFixed(1)} ms after release`
      ].filter(Boolean)
      verdict = failures.length ? `BUG REPRODUCED: ${failures.join(', ')}` : 'FIXED: no stall, reversal or jump'
      frozenOffsets = []
      console.log(`[clock-sync-repro] ${verdict}`)
    }

    const phase =
      verdict ?? (freezing ? 'frozen' : elapsed < FREEZE_AFTER_MS ? 'running, freeze in a few s' : 'released, settling')
    const lines = [
      `${((now / 1000) % 60).toFixed(1)} s`,
      '',
      `rtt ${stats.rtt.toFixed(0)} ms, best ${stats.bestRtt.toFixed(0)} ms, ${stats.samples} samples`,
      `offset to Date.now() ${stats.offset.toFixed(1)} ms${stats.frozen ? ', frozen' : ''}`,
      phase
    ]
    const color = verdict ? (verdict.startsWith('FIXED') ? Color4.Green() : Color4.Red()) : Color4.White()
    show(sign, lines.join('\n'), color)
  })
}

function show(entity: Entity, text: string, color: Color4) {
  TextShape.createOrReplace(entity, { text, fontSize: 2, textColor: color, width: 12, height: 6 })
}
