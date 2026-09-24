# server-side Storage: failures reported as data

Exercises every method of the server-side `Storage` API, and the edge cases around each, for
[js-sdk-toolchain#1630](https://github.com/decentraland/js-sdk-toolchain/pull/1630) on the
`auth-server` branch.

## The bug

`Storage` reported failures as data. `get()` resolved `null` both for a key that holds nothing and
for a read that failed; `getValues()` returned an empty page for both; `delete()` resolved `false`
for a confirmed absence and for any failure. A scene could not tell "nothing is stored" from "the
service did not answer", so an outage read as no data and the write that followed persisted that
over real data. Around that core, the PR also fixes the cache and write queue under pending writes,
rejects values that cannot round-trip, and brings the preview storage server in line with the
deployed `world-storage-service`.

## What the scene does

The authoritative server runs 61 checks against the storage service it reaches, then sends the
results to the client that asked, which shows them on a sign in front of the spawn point.

| Area | What is checked |
| --- | --- |
| round trip | set/get, a missing key, a stored `null`, keys named `constructor` and `__proto__` |
| failure is not absence | values over the 512 KB scene and 100 KB player limits; an invalid player address, a `..` address, a `..` key and a NUL character, which the SDK now rejects before sending |
| keys | a 256-character key, a 255-character key of emoji, the keys `''` and `.`, a NUL key, a `..` player key |
| serialization | `undefined`, functions, nested functions, symbols, circular values, an `undefined` array element or hole, `NaN`, `-Infinity`, a `Map`, `Set`, `RegExp`, `Error`, typed array, an unpaired surrogate, a `BigInt`, a nested `toJSON()` returning `undefined` and very deep nesting throw a `TypeError`; an `undefined` property is dropped, literal `\u0000` text and emoji round-trip, a `Date` is stored as its ISO string and a class instance as its data |
| delete | a stored key and a missing key |
| write queue | a read during an unawaited write, a read behind a queued write, rapid writes, a delete behind a set, a set behind a delete, a chain of replaced writes, a failing write never rejecting `set()` |
| cache | `skipIfUnchanged`, including while a newer write is pending, `fresh: true` |
| player | a checksummed address and its lowercase form, `getValues()` by prefix, the 1 MB per-player total, `delete()` |
| listing | the 100-entry page cap, key order, `limit` and `offset`, the 100000 offset cap, a stored `null` entry |
| configure | `cacheReads: false` |

Every check writes under a key prefix unique to the run, and cleans up afterwards.

## Running it

```bash
npm install
npm run verify   # headless: starts `sdk-commands start` and runs the checks over HTTP
npm start        # in-world: the verdict appears on the sign, and in `npm run server-logs`
```

`npm run verify` needs no explorer. It bundles `src/checks.ts` for Node, stands the scene runtime's
signed fetch in with a plain HTTP request (the preview storage routes do not check signatures),
starts `sdk-commands start --no-client`, and runs the same checks the scene runs. Exit code 1 when
any check fails. Set `VERBOSE=1` to see each failed request the SDK logs.

The scene pins the CI build of the PR head. To see the other column, switch builds:

```bash
npm run use:base   # the auth-server build the PR is based on
npm run use:pr     # back to the PR build
```

## Measured

`npm run verify` on both builds, each with its own `sdk-commands` preview server.

| Build | Verdict |
| --- | --- |
| `7.29.1-35154657340.commit-e2bbcc9` (auth-server base) | `BUG REPRODUCED: 40 of 61 checks fail` |
| `7.29.1-36021790753.commit-72e1674` (PR head `e359ed7c`) | `FIXED: all 61 checks pass` |

What the base build does on the checks that fail:

| Check | Base build |
| --- | --- |
| `get()`, `set()` and `delete()` with a 256-character key, `''`, `.` or a NUL key | send the request; the service's rejection comes back as `null`, `true` or `false` |
| player `get()` / `getValues()` with an invalid address | `null` / an empty page |
| player `set()` with the address `..` | resolves `true` and **overwrites the scene's own key**: `/players/../values/k` resolves to `/values/k` |
| `delete('..')` | resolves `false`, as if the key were confirmed absent: the request went to `/` |
| `set()` of `[1, undefined]`, an array hole, `NaN`, `-Infinity`, a `Map`, `Set`, `RegExp`, `Error`, a typed array, a nested `toJSON()` returning `undefined` or an unpaired surrogate | resolves `true` with the value stored changed |
| `set()` of a `BigInt` | throws the engine's unprefixed `TypeError` |
| `set()` with a rejected key, an invalid address, a NUL character, or an oversized value | resolves `true`: the preview server stored it, while the deployed service rejects it |
| `set()` of `undefined`, a function, a nested function or a symbol | resolves `true` with the value silently dropped |
| a key named `__proto__` | reads back `{}` |
| a read during an unawaited write | returns the old value |
| a set queued behind a delete | the read returns the value from before the delete |
| a failing fire-and-forget write (a value over the size limit) | resolves `true` |
| a read behind a queued write | can return the value from before that write |
| a player write past the 1 MB total | resolves `true` |
| `getValues()` with an offset of 10^9 | reports that offset, where the deployed service caps it at 100000 |
| a checksummed player address | stored under a different key than its lowercase form |
| listings | 101 entries served where the deployed service serves 100, in insertion order rather than key order |

Several of those are preview-server divergences rather than SDK bugs: on the deployed service a
rejected key, invalid address, NUL character or oversized value answers 400, so the base SDK's
`set()` would resolve `false` there. The preview server now answers the same way, which is what
lets the checks be run locally at all.

The checks run over real HTTP against a real preview server, but not inside the scene runtime:
the in-world path adds the runtime's signed fetch and its 32-concurrent-request cap, neither of
which changes an outcome here.

One check behaves differently for a reason other than a bug. Plain `JSON.stringify` has a fast path
that handles very deep nesting (a million levels on Node), but any replacer runs out of stack at about
5,100 levels, and the checked serializer needs one. So a 20,000-level value that the base build stores
is rejected here with a `TypeError`. No real stored state nests that deep.

