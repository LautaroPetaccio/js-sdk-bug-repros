# a peer's delete removing the wrong entity

Reproduction scene for [js-sdk-toolchain#1571](https://github.com/decentraland/js-sdk-toolchain/pull/1571) —
_fix(ecs): delete the mapped entity when a peer deletes a network one_.

When another player deletes a synchronised entity, this scene deletes **a different, live entity** in the
renderer, and the entity the peer actually deleted stays on screen.

## The bug

Receiving a `DELETE_ENTITY_NETWORK` resolves the peer's `(networkId, entityId)` pair to the local entity
it is mapped to, and then clears every component of that entity — `NetworkEntity` included, which is the
mapping itself:

```ts
for (const entity of entitiesShouldBeCleaned) {
  for (const definition of engine.componentsIter()) {
    definition.entityDeleted(entity, true)
  }
```

The same message is then forwarded to the renderer, where it is converted back into a plain
`DELETE_ENTITY`. That conversion resolves the pair a second time, and `findNetworkId` no longer finds
anything, so it falls back to the id carried in the message:

```ts
return { entityId: msg.entityId }   // the sending peer's id, not ours
```

## Who hits it

Any multiplayer scene, on the first delete. Entity ids are not per-player: every engine allocates from
the same reserved offset, so both players' first entity is `512`. The peer deleting **its** 512 makes
this scene tell the renderer to delete **its own** 512, which is an unrelated object that is still very
much alive. The entity that should have gone keeps its place, since only its components were cleared
locally and the renderer was never told about it.

## What the scene does

`src/index.ts` gives a private `Engine()` a renderer transport and a network transport, so the messages
that would go to the renderer can be read back instead of disappearing into the host.

1. It creates one local entity, which takes id 512, exactly like the peer's.
2. A crafted `PUT_COMPONENT_NETWORK` announces the peer's entity 512, which the engine maps to a local
   entity of its own.
3. A crafted `DELETE_ENTITY_NETWORK` deletes it.
4. The scene decodes what reached the renderer and reports which entity it was told to delete.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the renderer was told to delete the scene's own live entity, green
if it was told to delete the one the peer's entity was mapped to.

## Measured results

Headless, driving the same three steps, against `@dcl/sdk@7.26.0` and then against the same artifact
with #1571's lookup applied to `@dcl/ecs/dist/systems/crdt/index.js`:

| | peer's 512 mapped to | renderer told to delete | local 512 still alive |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | 513 | **512** | yes, and it was deleted in the renderer |
| with the fix | 513 | 513 | yes |

The last column is the giveaway: on both rows the scene's own entity still holds its `Transform`
locally, but on the first row the renderer has been told to remove it, so the two sides disagree about
what exists.

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

The scene builds the two inbound messages with the same writers the SDK uses over comms
(`PutNetworkComponentOperation`, `DeleteEntityNetwork`), so nothing here is a stand-in for the wire
format. Those and the `Transport` type live under `@dcl/ecs/dist/...` and are not re-exported from
`@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
