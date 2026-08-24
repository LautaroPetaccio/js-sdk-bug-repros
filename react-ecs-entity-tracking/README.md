# react-ecs entity tracking repro

Reproduction scene for [js-sdk-toolchain#1471 — *fix: release unmounted React ECS entities*](https://github.com/decentraland/js-sdk-toolchain/pull/1471).

## The bug

`packages/@dcl/react-ecs/src/reconciler/index.ts` keeps every entity the React
reconciler has ever created in a module-level set:

```ts
// Store all the entities so when we destroy the UI we can also destroy them
const entities = new Set<Entity>()
```

`createInstance` adds to it. `removeChildEntity` — the recursive unmount path —
cleans up `changeEvents`, `clickEvents` and `lastInputResultValues`, and calls
`engine.removeEntity(...)`, but never removes the id from `entities`:

```ts
function removeChildEntity(instance: Instance) {
  changeEvents.delete(instance.entity)
  clickEvents.delete(instance.entity)
  lastInputResultValues.delete(instance.entity)
  engine.removeEntity(instance.entity)
  for (const child of instance._child) {
    removeChildEntity(child)
  }
}
```

`system.ts`'s `destroy()` then iterates `renderer.getEntities()` and calls
`engine.removeEntity(entity)` for each. Two consequences:

1. **Unbounded growth.** Any UI that mounts and unmounts entities as it
   re-renders — a list whose length changes, a panel toggled by game state —
   adds one dead id to `entities` per unmounted entity, for the whole lifetime of
   the scene. Nothing ever removes them.
2. **Redundant work at `destroy()`.** `destroy()` issues one
   `engine.removeEntity()` call per id *ever mounted*, not per id currently
   mounted. Each of those calls walks the engine's whole component-definition
   map (`for (const [, component] of componentsDefinition) component.entityDeleted(...)`).

The fix is one line — `entities.delete(instance.entity)` at the top of
`removeChildEntity`.

## What this scene does

`src/ui.tsx` renders a 24-row panel that is mounted on even frames and unmounted
on odd ones, so each odd frame unmounts 25 entities (the panel plus its rows).

`src/index.ts` wraps `engine.removeEntity` and splits the call count into a
churn phase and a destroy phase. Both the reconciler's unmount path and
`ReactEcsRenderer.destroy()` reach `removeEntity` as a property of the shared
`engine` object, so a single patch counts both — the patch does not need to
happen before `ReactEcsRenderer` is constructed. It also classifies each
destroy-phase call with `engine.getEntityState(entity)`: `EntityState.Removed`
means the id was already dead, i.e. leaked.

After `CHURN_FRAMES` (250) frames it calls `ReactEcsRenderer.destroy()` and
reports. The UI is gone by then, so results go to `console.log` and to an
in-world `TextShape`.

## Running it

```bash
npm install
npm start
```

Look at the floating text at the centre of the parcel, or the preview console.

## Measured results

Driven headlessly through the QuickJS scene runtime for 250 churn frames plus
the destroy frame. The "broken" column reproduces identically on the pinned
published `@dcl/sdk@7.26.0` and on a local `js-sdk-toolchain` build; the "fixed"
column is the same local build with the one-line change applied.

| Metric | Broken | Fixed (one-line `entities.delete`) |
| --- | --- | --- |
| `removeEntity` calls during churn | 3125 | 3125 |
| `removeEntity` calls during `destroy()` | **3127** | **2** |
| — of those, ids already removed (leaked) | **3125** | **0** |
| — of those, ids still live | 2 | 2 |
| component definitions scanned per removal | 28 | 28 |
| wasted `entityDeleted` scans at destroy | **87 500** | **0** |
| `DELETE_ENTITY` CRDT messages, whole run | 3127 | 3127 |

The leak is linear in how long the UI churns. Raising `CHURN_FRAMES` from 250 to
1000 (a 4x longer session) scales it exactly 4x, and the fixed build stays flat:

| `CHURN_FRAMES` | Broken: leaked ids at destroy | Fixed: leaked ids at destroy |
| --- | --- | --- |
| 250 | 3125 | 0 |
| 1000 | 12 500 | 0 |

At most 27 entities are ever alive at once — the two persistent wrappers plus
the 25-entity panel. 250 frames is about eight seconds at 30 fps; a real scene
runs for minutes to hours.

### What the redundant `removeEntity` actually costs

Worth stating precisely, because it is narrower than "redundant CRDT traffic":

- `Engine.removeEntity(staleId)` calls `entityContainer.removeEntity`, which does
  **not** find the id in `usedEntities` (it was removed long ago) and so falls
  into the `updateRemovedEntity` branch. That branch never pushes onto
  `toRemoveEntities`, and `toRemoveEntities` is the only source of
  `DELETE_ENTITY` messages (`releaseRemovedEntities()` feeds
  `crdtSystem.sendMessages`). **No extra CRDT message is emitted** — the table
  above shows an identical 3127 `DELETE_ENTITY` total on both builds.
- `updateRemovedEntity` calls `removedEntities.addTo(n, v)` with an *older*
  version than the tombstone already holds. `createVersionGSet.addTo` returns
  early when `currentValue >= version`, so the free list is not corrupted. A
  recycled id is `toEntityId(n, tombstoneVersion + 1)`, strictly newer than any
  leaked id for `n`, so `updateRemovedEntity`'s `for (let i = 0; i <= v; i++)
  usedEntities.delete(...)` loop cannot evict the live entity that recycled the
  number either.
- What is left is real but local: `Engine.removeEntity` iterates every registered
  component definition and calls `entityDeleted` on each. 3125 stale calls x 28
  definitions = 87 500 wasted map lookups in one frame, plus the permanently
  growing `Set`.

So the honest harm is **unbounded set growth for the lifetime of the scene, and a
destroy-time burst proportional to the entire history of the UI** — not state
corruption and not extra renderer traffic.

## Re-testing against the fix

Every CI build of a branch publishes a version tagged with its commit, so to test
the PR branch before it merges:

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for the PR head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

Once the fix lands on `main`:

```bash
npm run upgrade-sdk:next          # npm install --save-dev @dcl/sdk@next
```

Compare the two destroy-phase numbers: `removals during destroy()` should collapse
from ~3127 to 2, and `ids already removed (leaked)` from 3125 to 0.

The scene as committed pins `@dcl/sdk@7.26.0`, whose published
`dist/reconciler/index.js` still has the unfixed `removeChildEntity`.
