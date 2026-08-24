# timer callback context leak

Reproduction scene for [js-sdk-toolchain#1470](https://github.com/decentraland/js-sdk-toolchain/pull/1470) —
_fix: clear timer context after callback errors_.

A timer callback that throws leaves `@dcl/ecs`'s timer system with a **stale arm context**. Every timer
armed afterwards — from ordinary scene code, not from inside a callback — is seeded with a negative
`accumulatedTime`, so its delay is silently inflated until some later callback happens to complete normally.

## The bug

`packages/@dcl/ecs/src/runtime/helpers/timers.ts`, `createTimers()`. While a callback runs, `armContext`
holds the time already consumed in the current frame _before_ that timer's logical fire instant, so a timer
armed from **inside** the callback measures its delay from the parent's fire instant instead of from the
start of the frame:

```ts
armContext = { accruedMs: elapsedMs - residualMs }
timerData.callback()
armContext = null // never reached if the callback throws
```

The throw propagates out of the timers system, out of `engine.update`, and out of `@dcl/sdk`'s `onUpdate`.
`armContext` is left set forever, and `addTimer` keeps seeding new timers with `accumulatedTime = -accruedMs`.
The fix wraps the call in `try { … } finally { armContext = null }`.

### Why the inflation can be large

For a non-recurrent timer `residualMs = accumulatedTime - interval`, so

```
accruedMs = elapsedMs - residualMs = interval - accumulatedTime_before_this_frame
```

bounded by both `interval` and the frame's `elapsedMs`. It is maximal when the throwing timer fires on its
**very first** frame (`accumulatedTime_before == 0`) and that frame is long enough to cover the whole
interval — then `accruedMs == interval`.

This scene arranges exactly that: it arms the throwing timer with a 1000 ms delay and then stalls for
1200 ms, so the next frame reports a `dt` large enough to fire it in a single step. The leaked
`accruedMs` is 1000 ms, and the next timer the scene arms takes **twice** its requested delay.

## What the scene does

`src/index.ts` runs a four-step script and measures three timers, all requesting the same 1000 ms delay.
Elapsed time is accumulated from `dt` in a system (deterministic, unlike the wall clock); that clock system
is registered above the timers system's priority so a callback reads a clock that already includes the
current frame.

1. **baseline** — armed and fired with a clean context.
2. **thrower** — armed, then a 1200 ms busy-wait; it fires on the next (long) frame and throws.
3. **poisoned** — armed on the first frame the scene reaches after the throw aborted a frame.
4. **recovered** — armed after the poisoned timer's own (throw-free) callback completed normally, which
   is what finally clears the stale context.

Results are printed with `console.log` and rendered in-world on a `TextShape` at `8,2,8`:

```
timer context leak after a throwing callback
1 baseline (clean context): requested 1000ms, measured 1000ms, delta +0ms
2 poisoned (armed after the throw): requested 1000ms, measured 2000ms, delta +1000ms
3 recovered (armed after a clean fire): requested 1000ms, measured 1000ms, delta +0ms
BUG REPRODUCED: the poisoned timer fired 1000ms late
```

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. The panel is white while measuring, red when the bug reproduces, green when
every timer fired on time. The console carries the same lines plus the per-step arming log.

One deliberate error is expected in the console on the long frame:
`deliberate failure inside a timer callback`. That is step 2 doing its job — the scene keeps running and
keeps reporting after it.

## Measured results

Driven headlessly at 100 ms frames, with a single 1200 ms frame right after the throwing timer is armed
(the deterministic equivalent of the scene's busy-wait):

| timer                                  | requested | broken (`@dcl/sdk@7.26.0`)   | fixed (PR #1470)          |
| -------------------------------------- | --------- | ---------------------------- | ------------------------- |
| 1 baseline (clean context)             | 1000 ms   | 1000 ms — delta **+0 ms**    | 1000 ms — delta **+0 ms** |
| 2 poisoned (armed after the throw)     | 1000 ms   | **2000 ms — delta +1000 ms** | 1000 ms — delta **+0 ms** |
| 3 recovered (armed after a clean fire) | 1000 ms   | 1000 ms — delta **+0 ms**    | 1000 ms — delta **+0 ms** |

Frame-by-frame, broken:

| frame | `dt`    | what happens                                                                                                                                                                          |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 0.000 s | baseline armed at `t=0ms`                                                                                                                                                             |
| 11    | 0.100 s | baseline fires at `t=1000ms` (**+0 ms**); thrower armed; 1200 ms busy-wait                                                                                                            |
| 12    | 1.200 s | thrower fires: `accumulatedTime` 0 → 1200, `residualMs` 200, `accruedMs` **1000**; throws; `engine.update` rejects, so the rest of the frame's systems and the CRDT flush are skipped |
| 13    | 0.100 s | poisoned armed at `t=2300ms`, seeded with `accumulatedTime = -1000`                                                                                                                   |
| 33    | 0.100 s | poisoned fires at `t=4300ms` — **2000 ms** for a 1000 ms request; recovered armed                                                                                                     |
| 43    | 0.100 s | recovered fires at `t=5300ms` (**+0 ms**) — the context was cleared by the poisoned callback returning                                                                                |

Fixed, the poisoned timer fires on frame 23 at `t=3300ms` and the whole script finishes on frame 33 instead
of 43. Frame 12 still aborts — the fix does not swallow the error, it only stops the context from leaking.

## Re-testing against the fix

`@dcl/sdk@7.26.0` (pinned here) and `@dcl/sdk@next` (the build of `main`, `7.26.1-32736599590.commit-6286b33`
at the time of writing) both still carry the bug — the `try/finally` is not on `main` yet.

Each CI build of a branch publishes a version tagged with its commit, so to test the PR branch directly:

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for the PR head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

Once the fix lands on `main`:

```bash
npm run upgrade-sdk:next          # npm install --save-dev @dcl/sdk@next
```

The panel should then read `FIXED: every timer fired on time` with a `+0 ms` delta on every row.

## Notes

- The in-world numbers depend on the host's `dt`. The leaked `accruedMs` is
  `min(interval, frame elapsed)`, so an explorer that clamps `dt` will show a smaller — but still
  non-zero — inflation on the poisoned timer. The baseline and recovered rows stay at `+0 ms` either way.
- The busy-wait is what produces the long frame in a real explorer. A headless driver feeds `dt` directly
  instead, which is how the numbers above were produced; the measurements are identical because the scene
  only ever reads `dt`.
- The scene never uses the wall clock for measurement, so a slow machine changes the frame count, not the
  reported deltas.
