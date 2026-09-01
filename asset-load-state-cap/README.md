# asset loading callbacks going silent at the cap

Reproduction scene for [js-sdk-toolchain#1583](https://github.com/decentraland/js-sdk-toolchain/pull/1583) —
_fix(ecs): keep delivering loading states once the set is full_.

The asset loading system stops calling your callback once the component holding the events is full. Not
for a frame, permanently: every loading event after that point is dropped, in the middle of loading.

## The bug

`packages/@dcl/ecs/src/systems/assetLoad.ts` decides which values are new by comparing counts:

```ts
if (loadingState.size === 0 || loadingState.size === data.lastLoadingStateLength) continue

// Get last added values (can be multiple per tick, just not for the same asset)
const lastValues = Array.from(loadingState.values()).slice(data.lastLoadingStateLength)
```

`AssetLoadLoadingState` is a grow-only value set with a cap. Once it is full, every new value evicts the
oldest one, so `size` stops changing. The guard reads that as "nothing happened" and returns. The
`slice` has the same flaw seen from the other end: after an eviction the index no longer points at the
first unseen value.

## Who hits it

Any scene loading enough assets to fill the set, which is what the component is for. The failure is
silent and terminal, and it lands exactly where it hurts: the events reporting that assets finished
loading are the ones after the busy stretch that filled the set.

## What the scene does

`src/index.ts` registers a loading callback on an entity, pushes enough loading states to fill the set,
and records how many were delivered. Then it pushes a handful more, one per frame, and records how many
of those arrived. The first number is the control: it shows the callback works right up until the set
stops growing.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when events after the cap are missing, green when all of them arrive.

## Measured results

Headless, the same sequence against `@dcl/sdk@7.26.0` and then against the same artifact with #1583
applied to `@dcl/ecs/dist/systems/assetLoad.js`:

| | delivered while the set filled | delivered after it was full |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | 100 of 100 | **0 of 5** |
| with the fix | 100 of 100 | 5 of 5 |

## Re-testing against the fix

Each CI build of a branch publishes a version tagged with its commit:

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for the PR head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

Once the fix lands on `main`:

```bash
npm run upgrade-sdk:next          # npm install --save-dev @dcl/sdk@next
```

## Notes

The fix tracks the last timestamp handed to the callback rather than a count. The set already orders by
that timestamp and eviction cannot disturb it.

This scene drives the scene's own engine rather than a private one, because the system factory is
internal: only the ready-made `assetLoadLoadingStateSystem` is exported to scenes.
