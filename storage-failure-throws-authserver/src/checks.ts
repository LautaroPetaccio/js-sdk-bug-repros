// Every check drives the real server-side Storage API against whatever storage service the
// scene reaches: the local preview server under `npm start`, or the one `npm run verify` starts.
// Nothing here touches the engine, so the same file runs in the scene and in the headless runner.

import type { IStorage } from '@dcl/sdk/server'

export type CheckResult = { area: string; name: string; expected: string; got: string; pass: boolean }

type Outcome = { kind: 'value'; value: unknown } | { kind: 'error'; message: string; isTypeError: boolean }

const PLAYER = '0x1234567890abcdef1234567890abcdef12345678'
const PLAYER_CHECKSUMMED = '0x1234567890ABCDEF1234567890abcdef12345678'
const CHECK_TIMEOUT_MS = 30_000

async function attempt(run: () => Promise<unknown> | unknown): Promise<Outcome> {
  try {
    const value = await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS))
    ])
    return { kind: 'value', value }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', message, isTypeError: error instanceof TypeError }
  }
}

function describe(outcome: Outcome): string {
  if (outcome.kind === 'error') return `threw ${outcome.isTypeError ? 'TypeError' : 'Error'}: ${outcome.message.slice(0, 80)}`
  const text = JSON.stringify(outcome.value)
  return `resolved ${text === undefined ? 'undefined' : text.length > 80 ? text.slice(0, 77) + '...' : text}`
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const resolvesTo = (expected: unknown) => (o: Outcome) => o.kind === 'value' && same(o.value, expected)
const throwsError = (o: Outcome) => o.kind === 'error' && !o.isTypeError
const throwsTypeError = (o: Outcome) => o.kind === 'error' && o.isTypeError
const settle = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) })
  )

export async function runChecks(Storage: IStorage, log: (line: string) => void = () => {}): Promise<CheckResult[]> {
  const run = `repro-${Date.now().toString(36)}`
  const k = (name: string) => `${run}:${name}`
  const results: CheckResult[] = []

  async function check(area: string, name: string, expected: string, scenario: () => Promise<unknown> | unknown, pass: (o: Outcome) => boolean) {
    const outcome = await attempt(scenario)
    const result = { area, name, expected, got: describe(outcome), pass: pass(outcome) }
    results.push(result)
    log(`${result.pass ? 'PASS' : 'FAIL'}  [${area}] ${name} — expected ${expected}, ${result.got}`)
  }

  const longKey = 'k'.repeat(256)

  // ── Round trips ──────────────────────────────────────────────────────────
  await check('round trip', 'set then get returns the value', 'resolved {"hp":3}', async () => {
    await Storage.set(k('rt'), { hp: 3 })
    return Storage.get(k('rt'), { fresh: true })
  }, resolvesTo({ hp: 3 }))

  await check('round trip', 'a missing key reads as null', 'resolved null', () => Storage.get(k('missing')), resolvesTo(null))

  await check('round trip', 'a stored null reads as null', 'resolved null', async () => {
    await Storage.set(k('null'), null)
    return Storage.get(k('null'), { fresh: true })
  }, resolvesTo(null))

  await check('round trip', 'a key named constructor that was never written reads as null', 'resolved null', () =>
    Storage.get('constructor', { fresh: true }), resolvesTo(null))

  await check('round trip', 'a key named __proto__ round-trips like any key', 'resolved {"hp":1}', async () => {
    await Storage.set('__proto__', { hp: 1 })
    const value = await Storage.get('__proto__', { fresh: true })
    await Storage.delete('__proto__')
    return value
  }, resolvesTo({ hp: 1 }))

  // ── Failures are never reported as absence ───────────────────────────────
  await check('keys', 'a 256-character key throws a TypeError in get(), set() and delete() before sending', 'resolved ["TypeError","TypeError","TypeError"]', async () =>
    Promise.all([Storage.get(longKey), Storage.set(longKey, 1), Storage.delete(longKey)].map((p) =>
      p.then(() => 'resolved', (e: unknown) => (e instanceof TypeError ? 'TypeError' : 'Error'))
    )), resolvesTo(['TypeError', 'TypeError', 'TypeError']))

  await check('keys', 'a 255-character key, counted in characters, round-trips', 'resolved [true,1]', async () => {
    const key = '\u{1F600}'.repeat(255)
    const stored = await Storage.set(key, 1)
    const value = await Storage.get(key, { fresh: true })
    await Storage.delete(key)
    return [stored, value]
  }, resolvesTo([true, 1]))

  await check('keys', 'the keys "", "." and a NUL key throw a TypeError', 'resolved ["TypeError","TypeError","TypeError"]', async () =>
    Promise.all(['', '.', 'a\u0000b'].map((key) =>
      Storage.set(key, 1).then(() => 'resolved', (e: unknown) => (e instanceof TypeError ? 'TypeError' : 'Error'))
    )), resolvesTo(['TypeError', 'TypeError', 'TypeError']))

  await check('keys', 'a player key of ".." throws a TypeError', 'threw TypeError', () =>
    Storage.player.set(PLAYER, '..', 1), throwsTypeError)

  await check('failure is not absence', 'player get() with an invalid address throws a TypeError', 'threw TypeError', () =>
    Storage.player.get('not-an-address', 'k', { fresh: true }), throwsTypeError)

  await check('failure is not absence', 'player getValues() with an invalid address throws a TypeError', 'threw TypeError', () =>
    Storage.player.getValues('not-an-address'), throwsTypeError)

  await check('failure is not absence', 'player set() with an invalid address throws a TypeError', 'threw TypeError', () =>
    Storage.player.set('not-an-address', 'k', 1), throwsTypeError)

  await check('failure is not absence', 'a player address of ".." never reaches scene storage', 'resolved [true,"threw",null]', async () => {
    await Storage.set(k('trav'), 'scene')
    const attempt = await Storage.player.set('..', k('trav'), 'player').then(String, () => 'threw')
    return [true, attempt, (await Storage.get(k('trav'), { fresh: true })) === 'scene' ? null : 'overwritten']
  }, resolvesTo([true, 'threw', null]))

  await check('failure is not absence', 'delete("..") throws instead of reporting a confirmed absence', 'threw TypeError', () =>
    Storage.delete('..'), throwsTypeError)

  await check('failure is not absence', 'set() of a value with a NUL character throws and stores nothing', 'resolved ["threw",null]', async () => [
    await Storage.set(k('nul'), 'a\u0000b').then(String, () => 'threw'),
    await Storage.get(k('nul'), { fresh: true })
  ], resolvesTo(['threw', null]))

  await check('failure is not absence', 'set() of a scene value over 512 KB resolves false', 'resolved false', () =>
    Storage.set(k('big'), 'a'.repeat(600 * 1024)), resolvesTo(false))

  await check('failure is not absence', 'player set() of a value over 100 KB resolves false', 'resolved false', () =>
    Storage.player.set(PLAYER, k('big'), 'a'.repeat(110 * 1024)), resolvesTo(false))

  // ── Values that cannot round-trip ────────────────────────────────────────
  await check('serialization', 'set(undefined) throws a TypeError and sends nothing', 'threw TypeError', () =>
    Storage.set(k('undef'), undefined), throwsTypeError)
  await check('serialization', 'set() of a function throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('fn'), () => 1), throwsTypeError)
  await check('serialization', 'set() of a nested function throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('nested-fn'), { onClick: () => 1 }), throwsTypeError)
  await check('serialization', 'set() of a symbol throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('sym'), Symbol('s')), throwsTypeError)
  await check('serialization', 'set() of a circular value throws a TypeError', 'threw TypeError', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    return Storage.set(k('circ'), circular)
  }, throwsTypeError)
  await check('serialization', 'an undefined array element throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('arr-undef'), [1, undefined]), throwsTypeError)
  await check('serialization', 'NaN throws a TypeError', 'threw TypeError', () => Storage.set(k('nan'), { hp: NaN }), throwsTypeError)
  await check('serialization', 'a Map throws a TypeError', 'threw TypeError', () => Storage.set(k('map'), new Map([['a', 1]])), throwsTypeError)
  await check('serialization', 'a typed array throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('bytes'), new Uint8Array([1, 2])), throwsTypeError)
  await check('serialization', 'an unpaired surrogate throws a TypeError', 'threw TypeError', () =>
    Storage.set(k('surrogate'), 'a\ud800'), throwsTypeError)
  await check('serialization', 'a BigInt throws a TypeError naming the key', 'resolved "prefixed"', async () => {
    try {
      await Storage.set(k('big-int'), { n: BigInt(1) })
      return 'resolved'
    } catch (error) {
      return error instanceof TypeError && error.message.startsWith('Storage.set(') ? 'prefixed' : `unprefixed: ${String(error)}`
    }
  }, resolvesTo('prefixed'))
  const rejected: Array<[string, () => unknown]> = [
    ['a nested -Infinity', () => ({ score: -Infinity })],
    ['a Set', () => new Set([1])],
    ['a RegExp', () => ({ pattern: /a/ })],
    ['an Error', () => ({ error: new Error('x') })],
    ['an array hole', () => [1, , 3]], // eslint-disable-line no-sparse-arrays
    ['a nested toJSON() returning undefined', () => ({ a: { toJSON: () => undefined } })]
  ]
  for (const [label, make] of rejected) {
    await check('serialization', `${label} throws a TypeError`, 'threw TypeError', () => Storage.set(k('rejected'), make()), throwsTypeError)
  }
  await check('serialization', 'nesting deeper than the engine stack throws a prefixed TypeError', 'resolved "prefixed"', async () => {
    const root: Record<string, unknown> = {}
    let at = root
    for (let i = 0; i < 20000; i++) {
      const next: Record<string, unknown> = {}
      at.n = next
      at = next
    }
    return Storage.set(k('deep'), root).then(
      () => 'resolved',
      (e: unknown) => (e instanceof TypeError && e.message.startsWith('Storage.set(') ? 'prefixed' : `unprefixed: ${String(e)}`)
    )
  }, resolvesTo('prefixed'))
  await check('serialization', 'literal "\\u0000" text and emoji round-trip unchanged', 'resolved {"note":"literal \\\\u0000","emoji":"\u{1F600}"}', async () => {
    await Storage.set(k('text'), { note: 'literal \\u0000', emoji: '\u{1F600}' })
    return Storage.get(k('text'), { fresh: true })
  }, resolvesTo({ note: 'literal \\u0000', emoji: '\u{1F600}' }))
  await check('serialization', 'a Date is stored as its ISO string', 'resolved {"at":"1970-01-01T00:00:00.000Z"}', async () => {
    await Storage.set(k('date'), { at: new Date(0) })
    return Storage.get(k('date'), { fresh: true })
  }, resolvesTo({ at: '1970-01-01T00:00:00.000Z' }))
  await check('serialization', 'a class instance is stored as its own data', 'resolved {"name":"rex"}', async () => {
    class Pet {
      name = 'rex'
      bark() {
        return 1
      }
    }
    await Storage.set(k('pet'), new Pet())
    return Storage.get(k('pet'), { fresh: true })
  }, resolvesTo({ name: 'rex' }))
  await check('serialization', 'an undefined property is dropped, not rejected', 'resolved {"kept":1}', async () => {
    await Storage.set(k('drop'), { kept: 1, dropped: undefined })
    return Storage.get(k('drop'), { fresh: true })
  }, resolvesTo({ kept: 1 }))

  // ── Delete ───────────────────────────────────────────────────────────────
  await check('delete', 'deleting a stored key resolves true and the key reads as null', 'resolved [true,null]', async () => {
    await Storage.set(k('del'), 1)
    return [await Storage.delete(k('del')), await Storage.get(k('del'))]
  }, resolvesTo([true, null]))
  await check('delete', 'deleting a missing key resolves true (the service answers 204)', 'resolved true', () =>
    Storage.delete(k('never')), resolvesTo(true))

  // ── Write queue and read-your-own-writes ─────────────────────────────────
  await check('write queue', 'a read issued during an unawaited write returns the new value', 'resolved "new"', async () => {
    await Storage.set(k('ryw'), 'old')
    void Storage.set(k('ryw'), 'new')
    return Storage.get(k('ryw'))
  }, resolvesTo('new'))

  await check('write queue', 'three rapid writes all resolve true and the last one wins', 'resolved [[true,true,true],3]', async () => {
    const results = await Promise.all([Storage.set(k('burst'), 1), Storage.set(k('burst'), 2), Storage.set(k('burst'), 3)])
    return [results, await Storage.get(k('burst'), { fresh: true })]
  }, resolvesTo([[true, true, true], 3]))

  await check('write queue', 'a delete queued behind a set leaves the key absent', 'resolved null', async () => {
    void Storage.set(k('sd'), 1)
    void Storage.delete(k('sd'))
    return Storage.get(k('sd'))
  }, resolvesTo(null))

  await check('write queue', 'a set queued behind a delete lands and reads back', 'resolved "after"', async () => {
    await Storage.set(k('ds'), 'before')
    void Storage.delete(k('ds'))
    void Storage.set(k('ds'), 'after')
    return Storage.get(k('ds'))
  }, resolvesTo('after'))

  await check('write queue', 'writes replaced in the queue all resolve with the last write', 'resolved [true,true,true,true,"c"]', async () => {
    const first = Storage.set(k('chain'), 'a')
    const second = Storage.set(k('chain'), 'b')
    const deleting = Storage.delete(k('chain'))
    const third = Storage.set(k('chain'), 'c')
    const settled = await Promise.all([first, second, deleting, third].map(settle))
    return [...settled.map((s) => (s.ok ? s.value : `rejected: ${s.error}`)), await Storage.get(k('chain'), { fresh: true })]
  }, resolvesTo([true, true, true, true, 'c']))

  await check('write queue', 'a failing write never rejects set(), even fire-and-forget', 'resolved false', () =>
    Storage.set(k('too-big'), 'a'.repeat(600 * 1024)).catch(() => 'rejected'), resolvesTo(false))

  await check('write queue', 'a read issued behind a queued write never returns an older value', 'resolved true', async () => {
    await Storage.set(k('behind'), 'old')
    void Storage.set(k('behind'), 'a')
    void Storage.set(k('behind'), 'b') // queued behind a
    const reading = Storage.get(k('behind'))
    void Storage.set(k('behind'), 'c') // replaces b after the read was issued
    return ['b', 'c'].includes((await reading) as string)
  }, resolvesTo(true))

  // ── Cache ────────────────────────────────────────────────────────────────
  await check('cache', 'skipIfUnchanged resolves true for an unchanged value', 'resolved [true,true]', async () => [
    await Storage.set(k('dedup'), 5),
    await Storage.set(k('dedup'), 5, { skipIfUnchanged: true })
  ], resolvesTo([true, true]))
  await check('cache', 'fresh: true returns the stored value', 'resolved 5', () => Storage.get(k('dedup'), { fresh: true }), resolvesTo(5))
  await check('cache', 'skipIfUnchanged does not skip a write while a newer one is pending', 'resolved 1', async () => {
    await Storage.set(k('pending-dedup'), 1)
    void Storage.set(k('pending-dedup'), 2)
    await Storage.set(k('pending-dedup'), 1, { skipIfUnchanged: true })
    return Storage.get(k('pending-dedup'), { fresh: true })
  }, resolvesTo(1))

  // ── Player storage ───────────────────────────────────────────────────────
  await check('player', 'a checksummed address and its lowercase form share one entry', 'resolved 7', async () => {
    await Storage.player.set(PLAYER_CHECKSUMMED, k('case'), 7)
    return Storage.player.get(PLAYER, k('case'), { fresh: true })
  }, resolvesTo(7))
  await check('player', 'player getValues() filters by prefix', 'resolved ["p:1","p:2"]', async () => {
    await Storage.player.set(PLAYER, k('p:2'), 2)
    await Storage.player.set(PLAYER, k('p:1'), 1)
    const page = await Storage.player.getValues(PLAYER, { prefix: k('p:') })
    return page.data.map((entry) => entry.key.replace(`${run}:`, ''))
  }, resolvesTo(['p:1', 'p:2']))
  await check('player', 'a write crossing the 1 MB per-player total resolves false', 'resolved [true,false]', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 11; i++) results.push(await Storage.player.set(PLAYER, k(`quota:${i}`), 'a'.repeat(100_000)))
    for (let i = 0; i < 11; i++) await Storage.player.delete(PLAYER, k(`quota:${i}`))
    return [results.slice(0, 10).every(Boolean), results[10]]
  }, resolvesTo([true, false]))
  await check('player', 'player delete() of a stored key resolves true', 'resolved [true,null]', async () => [
    await Storage.player.delete(PLAYER, k('case')),
    await Storage.player.get(PLAYER, k('case'))
  ], resolvesTo([true, null]))

  // ── Listing ──────────────────────────────────────────────────────────────
  const listed: string[] = []
  for (let i = 100; i >= 0; i--) listed.push(k(`list:${String(i).padStart(3, '0')}`))
  for (let i = 0; i < listed.length; i += 10) {
    await Promise.all(listed.slice(i, i + 10).map((key, j) => Storage.set(key, i + j)))
  }
  await check('listing', 'getValues() without a limit serves at most 100 of 101 entries', 'resolved [100,101]', async () => {
    const page = await Storage.getValues({ prefix: k('list:') })
    return [page.data.length, page.pagination.total]
  }, resolvesTo([100, 101]))
  await check('listing', 'getValues() lists entries in key order', 'resolved ["list:000","list:001"]', async () => {
    const page = await Storage.getValues({ prefix: k('list:'), limit: 2 })
    return page.data.map((entry) => entry.key.replace(`${run}:`, ''))
  }, resolvesTo(['list:000', 'list:001']))
  await check('listing', 'getValues() honours limit and offset', 'resolved [["list:100"],100]', async () => {
    const page = await Storage.getValues({ prefix: k('list:'), limit: 5, offset: 100 })
    return [page.data.map((entry) => entry.key.replace(`${run}:`, '')), page.pagination.offset]
  }, resolvesTo([['list:100'], 100]))
  await check('listing', 'getValues() caps an oversized offset at 100000', 'resolved 100000', async () =>
    (await Storage.getValues({ prefix: k('list:'), offset: 10 ** 9 })).pagination.offset, resolvesTo(100000))
  await check('listing', 'getValues() lists a stored null as an entry', 'resolved [null]', async () => {
    const page = await Storage.getValues({ prefix: k('null') })
    return page.data.map((entry) => entry.value)
  }, resolvesTo([null]))

  // ── Configuration ────────────────────────────────────────────────────────
  await check('configure', 'cacheReads: false still reads the stored value', 'resolved {"hp":3}', async () => {
    Storage.configure({ cacheReads: false })
    try {
      return await Storage.get(k('rt'))
    } finally {
      Storage.configure({ cacheReads: true })
    }
  }, resolvesTo({ hp: 3 }))

  // Best-effort cleanup so repeated runs do not fill the preview store.
  const written = [...listed, ...['rt', 'null', 'drop', 'ryw', 'burst', 'ds', 'chain', 'dedup', 'behind', 'pending-dedup', 'text', 'date', 'pet'].map(k)]
  for (let i = 0; i < written.length; i += 10) {
    await Promise.all(written.slice(i, i + 10).map((key) => Storage.delete(key).catch(() => undefined)))
  }
  await Promise.all([k('p:1'), k('p:2')].map((key) => Storage.player.delete(PLAYER, key).catch(() => undefined)))

  return results
}

export function summarize(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.pass)
  return failed.length === 0
    ? `FIXED: all ${results.length} checks pass`
    : `BUG REPRODUCED: ${failed.length} of ${results.length} checks fail`
}
