# cyclic parenting checker walking a cycle forever

Reproduction scene for [js-sdk-toolchain#1568](https://github.com/decentraland/js-sdk-toolchain/pull/1568) —
_fix(ecs): end the cyclic parenting walk at any cycle_.

`cyclicParentingChecker` walks a dirty transform's ancestors looking for a loop, but it only recognises
a loop that comes back to **the entity it started from**. A cycle further up the chain is never that
entity, so the walk goes round it forever and the scene thread stops. No frames, no input, no recovery.

## The bug

`packages/@dcl/ecs/src/systems/cyclicParentingChecker.ts`:

```ts
for (const entity of Transform.dirtyIterator()) {
  let transform = Transform.getOrNull(entity)
  while (transform && transform.parent) {
    if (transform.parent === entity) {
      console.error(`There is a cyclic parent with entity ${entity}`)
      break
    } else {
      transform = Transform.getOrNull(transform.parent)
    }
  }
}
```

The only exit conditions are "reached the root" and "came back to me". Walking `C → A → B → A → B …`
matches neither.

## Who hits it

It needs two ticks, which is what makes it easy to reach and easy to miss.

1. `A.parent = B` and `B.parent = A`. Both are dirty, so the checker starts from inside the cycle,
   recognises it, logs twice and returns. The scene survives and the developer sees the error.
2. Any later tick where something **outside** the cycle is parented onto it, or an existing descendant of
   it is touched. Now the dirty entity is not a member of the cycle, and the walk never ends.

So the checker survives the mistake being made and freezes on the next unrelated edit to a descendant.
The scene has to add the checker itself (`engine.addSystem(cyclicParentingChecker(engine))`), which is
what a scene does while debugging a parenting problem — exactly when cycles exist.

## What the scene does

`src/index.ts` gives a private `Engine()` the checker and steps through those two ticks:

1. Sixty frames in, it builds the `A ↔ B` cycle and runs one update. That update returns, and the sign
   records that the checker reported it.
2. Sixty frames later the readout switches to the `BUG REPRODUCED` text, and that frame is allowed to
   finish so the renderer actually receives it.
3. On the next frame it parents a third entity onto the cycle and runs another update. On a released SDK
   that update never comes back and the sign keeps the text from step 2 forever. On a fixed SDK the sign
   flips to `FIXED` with a frame counter that keeps climbing.

`engine.update()` is async, so the scene flips to `FIXED` from the update's `then` rather than after the
call — otherwise a released SDK would print `FIXED` and only then freeze.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White while it counts down, then red and frozen when the bug reproduces,
green and counting when it does not.

## Measured results

Headless, driving the same two ticks the scene drives, against `@dcl/sdk@7.26.0` and then against the
same artifact with #1568's walk applied to `@dcl/ecs/dist/systems/cyclicParentingChecker.js`:

| | first update (cycle built) | second update (third entity parented onto it) | process exit |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | returns, logs twice | **never returns** | killed at 20 s (`142`) |
| with the fix | returns, logs twice | returns, logs once | `0` |

The first column is the point: the checker looks like it is working right up until the tick that kills
the scene.

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

The per-engine `Transform(engine)` factory is typed under `@dcl/ecs/dist/components` and not re-exported
from `@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
