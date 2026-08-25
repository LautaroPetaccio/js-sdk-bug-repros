/**
 * Conformance scene for the `@dcl/sdk/players` rewrite (js-sdk-toolchain#1512).
 *
 * Unlike the other scenes here, this one is not a single bug: #1512 fixes eight defects in the
 * helper and adds an API around them, so this runs a CHECK MATRIX instead of one measurement.
 * Each check reports PASS / FAIL / N-A, and the verdict is the roll-up.
 *
 * Everything runs against an isolated `Engine()` whose `update()` this scene drives by hand,
 * one step per frame, so nothing depends on a second peer, a live explorer, or frame timing —
 * the same approach `tween-system-cache` uses, and the reason the numbers here are exact.
 * Players are synthesized by creating `PlayerIdentityData` / `AvatarBase` directly, which is
 * what the helper actually reads.
 *
 * Departures work on both SDKs here, which is worth knowing before reading the `leave/` rows:
 * a LOCAL `removeEntity` reaches the same `onChange` hook the pre-#1512 helper listens on,
 * because `crdtSceneSystem.sendMessages` reports locally-deleted entities through
 * `onProcessEntityComponentChange` even with no transport attached. So the old code does detect
 * this departure. What it cannot do is carry the last-known state, which is the row that fails.
 * The old code's own leave bug — a peer losing identity without a profile change — needs a real
 * peer and is out of reach here.
 */
import { Engine, Entity, IEngine } from '@dcl/sdk/ecs'
import { definePlayerHelper } from '@dcl/sdk/players'
import {
  AvatarBase as defineAvatarBase,
  AvatarEquippedData as defineAvatarEquippedData,
  PlayerIdentityData as definePlayerIdentityData
} from '@dcl/ecs/dist/components'

// ── The surface under test ──
// Declared locally, with everything #1512 adds optional, so this scene compiles against the
// OLD typings (where the helper is `{ onEnterScene, onLeaveScene, getPlayer }` and
// `GetPlayerDataRes` is not even exported) and still calls the new API when it is present.
// Every check guards on the member existing rather than assuming it.

type ProbePlayer = {
  entity: Entity
  userId: string
  name: string
  isGuest: boolean
  avatar?: { name: string; skinColor?: { r: number; g: number; b: number } }
  wearables: string[]
  emotes: string[]
  // #1512 additions
  displayName?: string
  nameResolved?: boolean
  joinedAtMs?: number
}

type ProbeSnapshot = { userId: string; displayName?: string; nameResolved?: boolean }
type ProbeOptions = { requireProfile?: boolean; replayPresent?: boolean }

type ProbeHelper = {
  onEnterScene(cb: (player: ProbePlayer) => void, options?: ProbeOptions): void | (() => void)
  onLeaveScene(cb: (userId: string, lastKnown?: ProbeSnapshot) => void, options?: ProbeOptions): void | (() => void)
  getPlayer(user?: { userId: string }): ProbePlayer | null
  onPlayerNameChanged?(cb: (player: ProbePlayer) => void): () => void
  getPlayers?(): ProbePlayer[]
  getPlayerCount?(): number
}

// ── Results ──

export type Status = 'PASS' | 'FAIL' | 'N-A'
export type Check = { id: string; status: Status; detail: string }

export const checks: Check[] = []

function record(id: string, status: Status, detail: string) {
  checks.push({ id, status, detail })
}

/** PASS when `actual` matches, FAIL otherwise, with both values in the detail. */
function expect(id: string, actual: unknown, wanted: unknown, note = '') {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  record(id, ok ? 'PASS' : 'FAIL', ok ? note || 'as expected' : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`)
}

/** Marks a check that needs API the installed SDK does not have. */
function missing(id: string, member: string) {
  record(id, 'N-A', `${member} absent — pre-#1512 SDK`)
}

// ── Harness ──

const WHITE = { r: 1, g: 1, b: 1 }

type Harness = {
  engine: IEngine
  helper: ProbeHelper
  /** Arrival payloads, per threshold. */
  identityArrivals: ProbePlayer[]
  profileArrivals: ProbePlayer[]
  departures: { userId: string; lastKnown?: ProbeSnapshot }[]
  nameChanges: ProbePlayer[]
  /** Arrival count as the probe system saw it, on the frame it last ran. */
  probeSawArrivals: number
  addIdentity(address: string, isGuest?: boolean): Entity
  addProfile(entity: Entity, name: string): void
  setName(entity: Entity, name: string): void
  dropProfile(entity: Entity): void
  remove(entity: Entity): void
  avatarName(entity: Entity): string
  skinRed(entity: Entity): number
  wearableCount(entity: Entity): number
  tick(): void
}

function harness(subscribe: 'default' | 'identity' | 'both' | 'none' = 'both'): Harness {
  const e = Engine()
  const PlayerIdentityData = definePlayerIdentityData(e)
  const AvatarBase = defineAvatarBase(e)
  const AvatarEquippedData = defineAvatarEquippedData(e)

  const h: Partial<Harness> = {
    engine: e,
    identityArrivals: [],
    profileArrivals: [],
    departures: [],
    nameChanges: [],
    probeSawArrivals: -1
  }

  // Registered BEFORE the helper, deliberately: this is what exercises the tracking system's
  // priority. Pre-#1512 the helper also took the default priority, so insertion order put this
  // probe first and it observed the arrival one frame late.
  e.addSystem(
    () => {
      h.probeSawArrivals = (h.identityArrivals!.length || 0) + (h.profileArrivals!.length || 0)
    },
    undefined,
    'repro/probe'
  )

  const helper = definePlayerHelper(e) as unknown as ProbeHelper

  if (subscribe === 'default' || subscribe === 'both') {
    helper.onEnterScene((p) => h.profileArrivals!.push(p))
    helper.onLeaveScene((userId, lastKnown) => h.departures!.push({ userId, lastKnown }))
  }
  if ((subscribe === 'identity' || subscribe === 'both') && supportsThresholds(helper)) {
    helper.onEnterScene((p) => h.identityArrivals!.push(p), { requireProfile: false })
  }
  if (helper.onPlayerNameChanged) {
    helper.onPlayerNameChanged((p) => h.nameChanges!.push(p))
  }

  return Object.assign(h, {
    helper,
    addIdentity(address: string, isGuest = false) {
      const entity = e.addEntity()
      PlayerIdentityData.create(entity, { address, isGuest })
      return entity
    },
    addProfile(entity: Entity, name: string) {
      AvatarBase.create(entity, {
        name,
        bodyShapeUrn: 'urn:decentraland:off-chain:base-avatars:BaseMale',
        skinColor: { ...WHITE },
        eyesColor: { ...WHITE },
        hairColor: { ...WHITE }
      })
      AvatarEquippedData.create(entity, { wearableUrns: ['urn:wearable:one'], emoteUrns: [] })
    },
    setName(entity: Entity, name: string) {
      AvatarBase.getMutable(entity).name = name
    },
    dropProfile(entity: Entity) {
      AvatarBase.deleteFrom(entity)
    },
    remove(entity: Entity) {
      e.removeEntity(entity)
    },
    avatarName(entity: Entity) {
      return AvatarBase.getOrNull(entity)?.name ?? '<none>'
    },
    skinRed(entity: Entity) {
      return AvatarBase.getOrNull(entity)?.skinColor?.r ?? -1
    },
    wearableCount(entity: Entity) {
      return AvatarEquippedData.getOrNull(entity)?.wearableUrns.length ?? -1
    },
    tick() {
      void e.update(1 / 30)
    }
  }) as Harness
}

/** Does this helper accept the `requireProfile` threshold option? */
function supportsThresholds(helper: ProbeHelper): boolean {
  // The option is only meaningful alongside the rest of the #1512 surface, and `getPlayers` is
  // the cheapest witness for it — probing by calling onEnterScene would register a subscription.
  return typeof helper.getPlayers === 'function'
}

// ── The script ──
// One `yield` per frame. `engine.update()` awaits internally even with no transport attached,
// so its systems have not run when it returns; yielding lets that microtask drain before the
// next step reads anything.

const ADDRESS = '0xAbCdEf0123456789000000000000000000000001'
const OTHER = '0xAbCdEf0123456789000000000000000000000002'

export function* script(): Generator<void, void, void> {
  // ── Arrival thresholds ──
  {
    const h = harness()
    const player = h.addIdentity(ADDRESS)
    h.tick()
    yield

    if (supportsThresholds(h.helper)) {
      expect('arrival/identity-threshold', h.identityArrivals.length, 1, 'identity-only player announced')
    } else {
      missing('arrival/identity-threshold', 'requireProfile')
    }
    expect('arrival/default-threshold-waits', h.profileArrivals.length, 0, 'no profile yet, so no default arrival')

    // The tracker must have settled before scene systems run in the same frame.
    expect('ordering/tracker-runs-first', h.probeSawArrivals > 0, true, 'probe observed the arrival in its own frame')

    h.addProfile(player, 'Ada')
    h.tick()
    yield
    expect('arrival/default-threshold-fires', h.profileArrivals.length, 1, 'announced once the profile landed')
    expect('arrival/identity-not-repeated', h.identityArrivals.length, supportsThresholds(h.helper) ? 1 : 0)
  }

  // ── Duplicate address: one arrival, and the informative entity wins ──
  {
    const h = harness()
    const stale = h.addIdentity(ADDRESS)
    const live = h.addIdentity(ADDRESS)
    h.addProfile(live, 'Ada')
    h.tick()
    yield

    expect('duplicate/single-arrival', h.profileArrivals.length, 1, 'one address, one arrival')
    const resolved = h.helper.getPlayer({ userId: ADDRESS })
    expect('duplicate/resolves-to-profile', resolved?.entity === live, true, `stale=${stale} live=${live}`)
  }

  // ── Case-insensitive lookup ──
  {
    const h = harness()
    const player = h.addIdentity(ADDRESS)
    h.addProfile(player, 'Ada')
    h.tick()
    yield
    expect('lookup/case-insensitive', h.helper.getPlayer({ userId: ADDRESS.toLowerCase() })?.entity === player, true)
    expect('lookup/empty-address-fails', h.helper.getPlayer({ userId: '' }), null, 'an empty address is not the local player')
  }

  // ── An identity row with no address must not crash the tracker ──
  // The subscriber reads `player.userId`, which is what any real handler does and what makes
  // this bite: pre-#1512 an empty-address row was announced as `getPlayer({ userId: '' })`,
  // which resolves to the local player entity, finds nothing on it, and returns null — then
  // gets dereferenced through a non-null assertion.
  {
    const h = harness('none')
    const announced: string[] = []
    h.helper.onEnterScene((p) => announced.push(p.userId))
    h.addIdentity('')
    const real = h.addIdentity(OTHER)
    h.addProfile(real, 'Grace')
    const before = escapedRejections
    h.tick()
    yield
    // `engine.update()` is async, so a throwing system surfaces as a rejected promise rather
    // than throwing at the call site — hence the hook rather than a try/catch.
    yield
    if (!rejectionHookInstalled) {
      record('robustness/empty-address-row', 'N-A', 'host cannot report unhandled rejections')
    } else {
      expect('robustness/empty-address-row', escapedRejections - before, 0, 'the row raised nothing')
    }
    expect('robustness/valid-row-still-seen', announced.length, 1, 'the real player was still announced')
  }

  // ── The payload must not alias component data ──
  {
    const h = harness()
    const player = h.addIdentity(ADDRESS)
    h.addProfile(player, 'Ada')
    h.tick()
    yield

    const payload = h.helper.getPlayer({ userId: ADDRESS })
    if (payload?.avatar?.skinColor) {
      try {
        payload.avatar.skinColor.r = 123
      } catch {
        /* a fully frozen payload is a stronger guarantee than a copy */
      }
    }
    try {
      payload?.wearables.push('urn:wearable:injected')
    } catch {
      /* likewise */
    }
    expect('aliasing/avatar-nested-colour', h.skinRed(player), 1, 'skinColor.r unchanged in the component')
    expect('aliasing/wearables-array', h.wearableCount(player), 1, 'wearable list unchanged in the component')
  }

  // ── displayName / nameResolved / sticky name ──
  {
    const h = harness()
    const player = h.addIdentity(ADDRESS)
    h.tick()
    yield

    const unresolved = h.helper.getPlayer({ userId: ADDRESS })
    if (unresolved?.displayName === undefined) {
      missing('name/display-never-empty', 'displayName')
      missing('name/resolved-flag', 'nameResolved')
    } else {
      expect('name/display-never-empty', (unresolved.displayName ?? '').length > 0, true, `"${unresolved.displayName}"`)
      expect('name/resolved-flag', unresolved.nameResolved, false, 'no profile yet')
    }

    h.addProfile(player, 'Ada')
    h.tick()
    yield
    if (h.helper.onPlayerNameChanged) {
      expect('name/change-event', h.nameChanges.length >= 1, true, 'onPlayerNameChanged fired')
    } else {
      missing('name/change-event', 'onPlayerNameChanged')
    }

    // A profile that momentarily reports empty must not downgrade a known name.
    h.setName(player, '')
    h.tick()
    yield
    const after = h.helper.getPlayer({ userId: ADDRESS })
    if (after?.nameResolved === undefined) {
      missing('name/sticky-on-empty', 'nameResolved')
    } else {
      expect('name/sticky-on-empty', [after.nameResolved, after.displayName], [true, 'Ada'])
    }
  }

  // ── Roster accessors ──
  {
    const h = harness()
    const first = h.addIdentity(ADDRESS)
    h.addProfile(first, 'Ada')
    const dupe = h.addIdentity(ADDRESS)
    h.addProfile(dupe, 'Ada')
    const second = h.addIdentity(OTHER)
    h.addProfile(second, 'Grace')
    h.tick()
    yield

    if (!h.helper.getPlayers || !h.helper.getPlayerCount) {
      missing('roster/collapses-duplicates', 'getPlayers')
      missing('roster/count-agrees', 'getPlayerCount')
    } else {
      expect('roster/collapses-duplicates', h.helper.getPlayers().length, 2, 'three entities, two addresses')
      expect('roster/count-agrees', h.helper.getPlayerCount(), h.helper.getPlayers().length)
    }
  }

  // ── Departure, with last-known state ──
  {
    const h = harness()
    const player = h.addIdentity(ADDRESS)
    h.addProfile(player, 'Ada')
    h.tick()
    yield
    h.remove(player)
    h.tick()
    yield

    expect('leave/fires-on-absence', h.departures.length, 1, 'departure detected without a CRDT hook')
    const lastKnown = h.departures[0]?.lastKnown
    if (h.departures.length === 0) {
      record('leave/last-known-snapshot', 'FAIL', 'no departure to carry a snapshot')
    } else if (lastKnown === undefined) {
      record('leave/last-known-snapshot', 'FAIL', 'departure carried no second argument')
    } else {
      expect('leave/last-known-snapshot', lastKnown.displayName, 'Ada', 'readable after the entity is gone')
    }
  }

  // ── Unsubscribe ──
  {
    const h = harness('none')
    const seen: string[] = []
    const off = h.helper.onEnterScene((p) => seen.push(p.userId))
    if (typeof off !== 'function') {
      missing('subscription/unsubscribe', 'unsubscribe return value')
    } else {
      off()
      const player = h.addIdentity(ADDRESS)
      h.addProfile(player, 'Ada')
      h.tick()
      yield
      expect('subscription/unsubscribe', seen.length, 0, 'no delivery after unsubscribing')
    }
  }

  // ── A throwing handler must not take its siblings, or the tracker, down ──
  // Synchronous on purpose: this is the `forEach` with no try/catch, and a sync throw is the
  // one shape that provably aborts the delivery loop rather than merely deferring a rejection.
  {
    const h = harness('none')
    const survivors: string[] = []
    h.helper.onEnterScene(() => {
      throw new Error('repro: handler threw on purpose')
    })
    h.helper.onEnterScene((p) => survivors.push(p.userId))

    const first = h.addIdentity(ADDRESS)
    h.addProfile(first, 'Ada')
    h.tick()
    yield
    expect('isolation/sibling-still-runs', survivors.length, 1, 'the throwing handler did not skip the next one')

    const second = h.addIdentity(OTHER)
    h.addProfile(second, 'Grace')
    h.tick()
    yield
    expect('isolation/tracker-survives', survivors.length, 2, 'a later arrival still delivered')
  }

  // ── An async handler's rejection must not escape the tracker ──
  // Only measurable where the host can report an unhandled rejection, so this reads N-A in the
  // scene runtime and is measured by `verify/run.ts`, which installs the hook.
  {
    const h = harness('none')
    const before = escapedRejections
    h.helper.onEnterScene(async () => {
      throw new Error('repro: handler rejected on purpose')
    })
    const player = h.addIdentity(ADDRESS)
    h.addProfile(player, 'Ada')
    h.tick()
    yield
    // One more frame: an escape surfaces a macrotask after the rejection is created.
    yield

    if (!rejectionHookInstalled) {
      record('isolation/async-rejection-contained', 'N-A', 'host cannot report unhandled rejections')
    } else {
      expect('isolation/async-rejection-contained', escapedRejections - before, 0, 'rejection was caught, not escaped')
    }
  }
}

// ── Host hook for unhandled rejections ──
// `checks.ts` stays runtime-agnostic: the host decides whether it can observe an escaped
// rejection, and reports one by calling `noteEscapedRejection`.

let escapedRejections = 0
let rejectionHookInstalled = false

export function installRejectionHook(): void {
  rejectionHookInstalled = true
}

export function noteEscapedRejection(): void {
  escapedRejections++
}

/** Roll-up of the matrix, shared by the scene readout and the headless runner. */
export function verdict(): { text: string; passed: number; failed: number; na: number } {
  const failed = checks.filter((c) => c.status === 'FAIL').length
  const na = checks.filter((c) => c.status === 'N-A').length
  const passed = checks.filter((c) => c.status === 'PASS').length

  const text =
    failed > 0
      ? `BUG REPRODUCED: ${failed} of ${checks.length} checks fail${na ? `, ${na} not applicable` : ''}`
      : na > 0
        ? `FIXED: ${passed} pass, ${na} not applicable to this SDK`
        : `FIXED: all ${passed} checks pass`

  return { text, passed, failed, na }
}

/** Drive the whole matrix to completion. Each step needs a macrotask so `update()` settles. */
export async function runAll(): Promise<Check[]> {
  const steps = script()
  for (;;) {
    if (steps.next().done) break
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
  }
  return checks
}
