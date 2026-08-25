# `@dcl/sdk/players` tracking

[js-sdk-toolchain#1512](https://github.com/decentraland/js-sdk-toolchain/pull/1512)

Unlike the other scenes here, this one is not a single bug. #1512 rewrites the players helper,
fixing eight defects and adding an API around them, so this scene runs a **check matrix** — 25
rows, each `PASS` / `FAIL` / `N-A` — and rolls them up into the usual verdict.

On the pinned `@dcl/sdk@7.26.0`:

```
BUG REPRODUCED: 11 of 25 checks fail, 8 not applicable
pass=6 fail=11 n/a=8 total=25
```

Against the #1512 build:

```
FIXED: all 25 checks pass
pass=25 fail=0 n/a=0 total=25
```

The 8 `N-A` rows are the ones that need API the old helper does not have (`requireProfile`,
`displayName`, `nameResolved`, `onPlayerNameChanged`, `getPlayers`, `getPlayerCount`, and the
unsubscribe return value). The 11 `FAIL` rows are behaviour that exists in both versions.

## What each row exercises

| Row | On 7.26.0 |
| --- | --- |
| `arrival/identity-threshold` | N-A — `requireProfile` does not exist, so a player whose avatar profile has not replicated is never announced at all |
| `arrival/default-threshold-waits` | pass |
| `arrival/default-threshold-fires` | pass |
| `arrival/identity-not-repeated` | pass |
| `ordering/tracker-runs-first` | **fail** — the tracker takes the default system priority, so a scene system registered before the helper observes the arrival a frame late |
| `duplicate/single-arrival` | pass |
| `duplicate/resolves-to-profile` | **fail** — `getPlayer` takes the first entity by iteration order, which is the stale one |
| `lookup/case-insensitive` | **fail** — addresses are compared with `===`, so a lowercased address returns `null` |
| `lookup/empty-address-fails` | pass |
| `robustness/empty-address-row` | **fail** — an identity row with an empty address is announced as `getPlayer({ userId: '' })`, which resolves to the local player entity, returns `null`, and is dereferenced through a non-null assertion |
| `robustness/valid-row-still-seen` | **fail** — that throw aborts the delivery loop, so the real player beside it is never announced |
| `aliasing/avatar-nested-colour` | **fail** — writing `player.avatar.skinColor.r` lands in the component |
| `aliasing/wearables-array` | **fail** — pushing into `player.wearables` lands in the component |
| `name/display-never-empty`, `name/resolved-flag`, `name/change-event`, `name/sticky-on-empty` | N-A |
| `roster/collapses-duplicates`, `roster/count-agrees` | N-A |
| `leave/fires-on-absence` | pass |
| `leave/last-known-snapshot` | **fail** — the departure callback takes only a `userId`, and `getPlayer` returns `null` by then, so the departing player's name is unrecoverable |
| `subscription/unsubscribe` | N-A |
| `isolation/sibling-still-runs` | **fail** — the delivery loop has no `try`/`catch`, so one throwing handler skips every handler after it |
| `isolation/tracker-survives` | **fail** — and the tracker stays broken for the rest of the run |
| `isolation/async-rejection-contained` | **fail** — an `async` handler's rejection escapes the tracker entirely |

## Two things worth knowing about the measurements

**Departures work on both versions here.** The pre-#1512 helper detects leaves through
`AvatarBase.onChange`, which only fires from the CRDT path — but a *local* `removeEntity`
reaches it too, because `crdtSceneSystem.sendMessages` reports locally-deleted entities through
`onProcessEntityComponentChange` even with no transport attached. So `leave/fires-on-absence`
passes on 7.26.0, and only the snapshot row fails. The old code's own leave bug — a peer that
loses identity without a profile change ever firing — needs a real second peer and is out of
reach here.

**`engine.update()` is async**, so a throwing system surfaces as a rejected promise rather than
throwing at the call site. The two rows that measure an escape (`robustness/empty-address-row`,
`isolation/async-rejection-contained`) therefore read `N-A` unless the host can report an
unhandled rejection. `verify/run.ts` installs that hook; the in-world scene does not, so those
two rows show `N-A` in the readout and are measured headlessly.

## Running it

```
npm install
npm start          # in-world readout on a TextShape, and on the console
npm run verify     # the same matrix, headless, with the rejection hook installed
```

`npm run verify` is where the numbers above come from. It bundles `verify/run.ts` with esbuild
and runs it under plain Node — `@dcl/ecs` ships directory imports that Node's ESM resolver
rejects, hence the bundle step. Nothing in it needs a renderer or a second peer: every check
drives its own isolated `Engine()` and synthesizes players by creating `PlayerIdentityData` /
`AvatarBase` directly, which is what the helper actually reads.

Expect a stack trace in the `verify` output on a fixed SDK. That is `runIsolated` logging the
handler this scene throws on purpose — the isolation working, not a failure.

## Pointing it at the fix

The checks live in `src/checks.ts`, which imports nothing from the scene runtime, so the whole
matrix runs against whatever `@dcl/sdk/players` resolves to. #1512 touches only that module, so
overlaying the built one is enough:

```
cp <toolchain>/packages/@dcl/sdk/players/index.js \
   <toolchain>/packages/@dcl/sdk/players/index.d.ts \
   node_modules/@dcl/sdk/players/
npm run verify
```

Build the toolchain first (`make install-protobuf && make build` from a clean clone). The
verdict flips to `FIXED: all 25 checks pass`.

## Layout

```
src/checks.ts    the harness and the 25 checks — no scene-runtime imports
src/index.ts     in-world readout on a TextShape
verify/run.ts    headless runner, installs the unhandled-rejection hook
```
