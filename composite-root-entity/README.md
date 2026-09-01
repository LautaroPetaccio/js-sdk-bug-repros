# a composite instanced onto the root landing somewhere else

Reproduction scene for [js-sdk-toolchain#1587](https://github.com/decentraland/js-sdk-toolchain/pull/1587) —
_fix(ecs): instance composites onto the root entity properly_.

Instance a composite onto the scene root and its entities are parented to a **stray entity** instead:
one with no components, that is never handed back, and that nothing else references. The call returns
the root as though it worked.

## The bug

`packages/@dcl/ecs/src/composite/instance.ts` tests entities for truthiness, and `RootEntity` is `0`:

```ts
const compositeRootEntity = rootEntity ?? getCompositeEntity(0)
if (rootEntity) {
  mappedEntities.set(0 as Entity, rootEntity)
}
```

The `??` on the first line handles `0` correctly, which is exactly what makes the `if` under it look
fine. It is not: passing the root skips recording the mapping for composite entity 0.

The memo lookup has the same problem from the other side:

```ts
const existingEntity = mappedEntities.get(compositeEntity)
if (existingEntity) {
  return existingEntity
}
```

A mapping *onto* entity 0 reads as no mapping, so it would be allocated again on every lookup.

## Who hits it

`Composite.instance(engine, resource, provider, { rootEntity: engine.RootEntity })` is the natural way to
drop a composite into a scene at the top level. Everything in the composite ends up under an entity that
does not exist as far as the scene is concerned, so moving the "root" moves nothing and the hierarchy the
composite described is silently wrong.

## What the scene does

`src/index.ts` builds a small composite in memory holding two entities, both parented to the composite's
own root, instances it onto a private engine's `RootEntity`, and reports what the call returned along
with the parent each entity actually got.

Two entities rather than one on purpose: the second lookup of composite entity 0 is what exercises the
memo, which is the other half of the bug.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the entities hang off anything other than the root, green when they
hang off the root.

## Measured results

Headless, the same instancing against `@dcl/sdk@7.26.0` and then against the same artifact with #1587
applied to `@dcl/ecs/dist/composite/instance.js`:

| | root handed back | parents of the composite entities |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | `0` | **`[513, 513]`** |
| with the fix | `0` | `[0, 0]` |

The first column is why this is easy to miss: the return value is right on both rows.

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

Instancing onto an ordinary entity, and instancing without naming a root at all, both worked before and
still do; the toolchain PR covers all three.
