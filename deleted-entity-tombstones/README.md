# deleted entities leaving tombstones behind forever

Reproduction scene for [js-sdk-toolchain#1590](https://github.com/decentraland/js-sdk-toolchain/pull/1590) —
_fix(ecs): release component timestamps for entities that are gone_.

Deleting an entity drops its component data but keeps the Lamport timestamp. One entry per component per
entity, for the life of the scene. The map only grows, and the state a late joiner receives contains a
`DELETE_COMPONENT` tombstone for every entity the scene ever deleted.

## The bug

`packages/@dcl/ecs/src/engine/lww-element-set-component-definition.ts`:

```ts
entityDeleted(entity: Entity, markAsDirty: boolean): void {
  if (data.delete(entity) && markAsDirty) {
    dirtyIterator.add(entity)
  }
  lastSentData.delete(entity)      // `timestamps` is never touched
},
```

The state dump walks that same map and emits a tombstone for anything with a timestamp but no data:

```ts
for (const [entity, timestamp] of timestamps) {
  if (data.has(entity)) {
    PutComponentOperation.write(entity, timestamp, componentId, buf.toBinary(), buffer)
  } else {
    DeleteComponent.write(entity, componentId, timestamp, buffer)
  }
}
```

## Who hits it

Anything that churns entities: projectiles, particles, spawned props, UI elements built and torn down.
The cost is not visible frame to frame, which is what makes it easy to miss. It shows up as a scene that
slowly grows in memory over a long session, and as a join payload that keeps getting bigger for everyone
who arrives later, describing entities that no longer exist.

## What the scene does

`src/index.ts` creates and deletes entities on a private engine, a full create-update-delete-update cycle
each time, then reads the component's own state dump: the same call the SDK makes to build the state a
joining player is sent. It reports how many entities are still alive, how many tombstones the dump
contains, and how many bytes that is.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the dump still describes entities that are gone, green when it is
empty.

## Measured results

Headless, twenty-five create-and-delete cycles on one component, against `@dcl/sdk@7.26.0` and then
against the same artifact with #1590 applied to
`@dcl/ecs/dist/engine/lww-element-set-component-definition.js`:

| | entities alive | tombstones sent to a late joiner | bytes |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | 0 | **25** | **500** |
| with the fix | 0 | 0 | 0 |

One component, twenty-five entities. A scene with several components on each entity multiplies both
columns, and neither ever goes down.

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

A component removed from an entity that is **still alive** is a different case and keeps its timestamp:
that tombstone is meaningful, because the entity exists and a peer may be holding the component. Only
entities that are gone are released, and their ids are never handed out again, so nothing will ever need
the timestamp to resolve a conflict.
