# tween dirty serialization

Test scene for [js-sdk-toolchain#1477](https://github.com/decentraland/js-sdk-toolchain/pull/1477) —
_perf: serialize tweens only when dirty_.

Two jobs: show the per-frame cost of many active tweens, and confirm the optimization did not
break tween completion or sequences.

## The change

`packages/@dcl/ecs/src/systems/tween.ts` ran a cache system every frame that serialized **every**
active tween just to detect whether it had changed, using a `ReadWriteByteBuffer` that defaults to
a 10 KiB allocation and retaining that backing array per tween. The PR consults the Tween dirty set
first, serializes only new or dirty tweens into a right-sized buffer, and stores a copied snapshot.

## What the scene does

300 cubes, each with an active move `Tween`; 20 of them also carry a `TweenSequence` on
`TL_RESTART` so sequence advancement is exercised. Two bracketing systems — one at
`Number.MAX_VALUE`, one at `Number.MIN_SAFE_INTEGER` — measure the wall time the SDK's tween
systems consume inside each frame. After a 30-frame warm-up it averages 240 frames and reports on
a `TextShape` at `8,4,8`:

```
tween dirty serialization
active tweens: 300 (20 sequenced)
avg frame: X.XX ms   worst: X.XX ms
tween completions observed: N
sequence steps still queued: N
entities moved by their tween: N/300
BEHAVIOUR OK: tweens ran and completed
```

## Run it

```bash
npm install
npm start
```

**This scene must run in an Explorer.** Tweens are executed by the renderer — it moves the
`Transform` and writes `TweenState` back. A headless harness with a stub renderer drives none of
that, so the scene reports `NO RENDERER DRIVING TWEENS` rather than a false failure.

## What to compare

Run against the pinned `@dcl/sdk@7.26.0`, note `avg frame`, then re-run against a build carrying
the PR and compare. `completions`, `sequence steps still queued` and `entities moved` should be
unchanged — those are the "did it break anything" half.

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for the PR head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

## Measured off-scene

The cache system was also benchmarked directly, driving the engine without a renderer so only the
system's own cost is counted:

| active tweens | changing per frame | main | PR |
| --- | --- | --- | --- |
| 200 | 0 | 1.09 ms/frame | 0.32 ms/frame |
| 200 | 100 | 1.38 ms/frame | 0.78 ms/frame |
| 1 000 | 0 | 3.54 ms/frame | 1.08 ms/frame |
| 1 000 | 500 | 5.20 ms/frame | 3.53 ms/frame |

At 1 000 idle tweens that is 2.5 ms per frame returned, about 15% of a 60 fps budget. Unlike a
teardown-time saving this is recovered on *every* frame the tweens are active.

## Known behaviour difference

The PR moves initial cache population from the cache system into a `Tween.onChange` callback, which
costs one extra frame before a completion is observed. Measured with a 3-step `TweenSequence`: it
drains at frame 4 on `main` and frame 5 with the PR. Every existing tween test still passes, so
this is flagged for review rather than presented as settled.
