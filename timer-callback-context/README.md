# timer callback context leak

Reproduction scene for [js-sdk-toolchain#1470](https://github.com/decentraland/js-sdk-toolchain/pull/1470) —
_fix: clear timer context after callback errors_.

A timer callback that throws leaves `@dcl/ecs`'s timer system with a **stale arm context**. Every timer
armed afterwards — from ordinary scene code, not from inside a callback — is seeded with a negative
`accumulatedTime`, so it loses a frame, until some later callback happens to complete normally.

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
`armContext` is left set, and `addTimer` keeps seeding new timers with `accumulatedTime = -accruedMs`.
The fix wraps the call in `try { … } finally { armContext = null }`.

## How big is the leak, really

For a non-recurrent timer `residualMs = accumulatedTime - interval`, so

```
accruedMs = elapsedMs - residualMs = interval - accumulatedTime_before_this_frame
```

which is bounded by **both** `interval` and the frame's `elapsedMs`. That second bound is the one that
matters in practice: explorers clamp `dt` (Unity's `Time.maximumDeltaTime` defaults to 1/3 s), so no
amount of stalling makes a single frame long enough to leak more than about one frame's worth of time.
On a 60 fps client the leak is ~17 ms in absolute terms, whatever the interval.

So this scene does not chase milliseconds. It sizes the timer delay to **just under one frame** and
measures in frames. A clean timer fires on the first frame after it is armed; a poisoned one is seeded
with the whole interval as a negative offset, misses that frame, and fires on the second. One frame
versus two — a 100% error that reads the same at any frame rate.

## What the scene does

`src/index.ts` samples the host's frame time for 30 frames, sets the delay to 0.7 of the median frame,
and then runs 20 rounds of:

1. **baseline** — a timer armed and fired with a clean context.
2. **thrower** — a timer whose callback sets a flag and then throws. The flag matters: the throw aborts
   the frame, so the driver system does not run again until the next one and cannot otherwise tell that
   the callback ran.
3. **poisoned** — a timer armed on the first frame after the throw.

The poisoned timer's own callback returns normally, which is what clears the stale context — so each
round re-poisons it and the 20 rounds are independent samples.

Elapsed time and frames come from a system registered above the timers system's priority (systems run in
descending priority), so a callback reads counters that already include the current frame. Nothing uses
the wall clock, and there is no busy-wait: the scene never stalls.

Results are printed with `console.log` and rendered in-world on a `TextShape` at `8,2,8`:

```
timer context leak after a throwing callback
frame time 16.7ms, timer delay 11.7ms
rounds completed: 20/20
baseline timer: 1.00 frames, 16.7ms
poisoned timer: 2.00 frames, 33.4ms
rounds where the poisoned timer needed an extra frame: 20/20
BUG REPRODUCED: a timer armed after a throwing callback loses a whole frame
```

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. It is white while sampling and measuring, red when the bug reproduces, green
when every timer is measured from its own arming. Twenty rounds take a few seconds.

One error per round is expected in the console: `deliberate failure inside a timer callback`. That is step
2 doing its job — the scene keeps running and keeps reporting after it.

## Measured results

Driven headlessly at a constant frame time, with no long frame injected — i.e. what a real client looks
like. `@dcl/sdk@7.26.0` is the version this scene pins; "fixed" is that same published artifact with
PR #1470's `try/finally` applied to `@dcl/ecs/dist/runtime/helpers/timers.js`.

| frame time | broken: poisoned timer | fixed: poisoned timer | rounds late (broken / fixed) |
| --- | --- | --- | --- |
| 16.7 ms (60 fps) | **2.00 frames**, 33.4 ms | 1.00 frames, 16.7 ms | **20/20** / 0/20 |
| 33.3 ms (30 fps) | **2.00 frames**, 66.6 ms | 1.00 frames, 33.3 ms | **20/20** / 0/20 |
| 100 ms (10 fps) | **2.00 frames**, 200.0 ms | 1.00 frames, 100.0 ms | **20/20** / 0/20 |
| 16.7 ms with 25% jitter | **2.00 frames**, 33.1 ms | 1.00 frames, 16.6 ms | **20/20** / 0/20 |

The baseline timer reads 1.00 frames in every row of both columns, which is what makes the poisoned row
attributable to the stale context rather than to scheduling noise.

## Re-testing against the fix

`@dcl/sdk@7.26.0` (pinned here) and `@dcl/sdk@next` (the build of `main`) both still carry the bug — the
`try/finally` is not on `main` yet.

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

The sign should then read `FIXED`, with the poisoned timer at 1.00 frames and `0/20` late rounds.

## Notes

- The absolute millisecond figures scale with the host's frame time; the frame counts do not. That is why
  the verdict is keyed on frames, and why an earlier version of this scene — which armed a 1000 ms timer
  behind a 1200 ms busy-wait and looked for a 1000 ms delta — reported `FIXED` on a real client while
  reproducing perfectly against a headless driver fed a 1.2 s frame. The client clamped the long frame,
  the leak collapsed to ~19 ms, and the threshold hid it.
- A host that skips or coalesces scene frames changes how many frames a round takes, not the one-frame gap
  between the baseline and poisoned timers.
