# a withdrawn raycast running anyway

Reproduction scene for [js-sdk-toolchain#1586](https://github.com/decentraland/js-sdk-toolchain/pull/1586) —
_fix(ecs): let a raycast removal cancel a registration from the same frame_.

Register a raycast and remove it before the frame is over and it is installed anyway, one tick later. The
renderer runs a query the scene withdrew, and the callback fires on its result.

## The bug

`packages/@dcl/ecs/src/systems/raycast.ts` delays every registration by a frame, and says why:

```ts
// Raycasts registration is delayed 1 frame to avoid same-frame raycast
// removal/adding (the client never receives the removal on those situations)
const onNextTick = () => { ... }
nextTickRaycasts.push(onNextTick)
```

The removal never looks at that queue:

```ts
function removeRaycast(entity: Entity) {
  Raycast.deleteFrom(entity)
  RaycastResult.deleteFrom(entity)
  entitiesCallbackResultMap.delete(entity)
}
```

So the delay exists precisely for this case and does not cover it. The queued closure still runs and
calls `Raycast.createOrReplace(entity)`.

## Who hits it

Any code path that decides against a raycast after asking for one, in the same frame: a guard that runs
later in the system, a state change between two systems, a helper that registers on enter and removes on
exit when both happen in one tick. Nothing about it looks wrong from the scene's side, which is why the
stray query is hard to trace back.

## What the scene does

`src/index.ts` asks for two raycasts. The first is withdrawn immediately with `removeRaycasterEntity`;
the second is left alone and acts as the control. It then watches both entities for a few frames, long
enough to outlast the deliberate one-frame delay, and reports whether each raycast was ever installed.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the withdrawn raycast is installed anyway, green when only the kept
one is.

## Measured results

Headless, the same two registrations against `@dcl/sdk@7.26.0` and then against the same artifact with
#1586 applied to `@dcl/ecs/dist/systems/raycast.js`:

| | withdrawn raycast installed | kept raycast installed |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **yes** | yes |
| with the fix | no | yes |

The second column matters: the fix cancels only the registration the removal is undoing, not the queue.

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

The pending registrations are keyed by entity rather than filtered out, so removing and then registering
again in one frame still honours the last thing the scene asked for.
