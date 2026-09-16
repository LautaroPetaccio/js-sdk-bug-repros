# deleting a synced entity you do not own

Reproduction scene for an **open issue with no fix PR yet**. It is related to, but not fixed by,
[js-sdk-toolchain#1608](https://github.com/decentraland/js-sdk-toolchain/pull/1608): #1608 gates entity
*creation*, and a delete targets an entity that already exists, which it leaves open.

Receiving a `DELETE_ENTITY_NETWORK` for a known `(networkId, entityId)` pair destroys that entity —
every component, on the owner's own client included. Nothing checks that the sender owns it, so **any
peer can delete any synced entity in the scene**.

## Not the same as `network-delete-wrong-entity` (#1571)

They touch the same message type but are different bugs:

| | who deletes | what breaks |
| --- | --- | --- |
| [`network-delete-wrong-entity`](../network-delete-wrong-entity) (#1571) | the entity's **owner** | the delete lands on the **wrong local entity** (renderer aliasing) |
| this scene (no PR) | a **non-owner** | the delete lands on the **correct** entity, but should never have been accepted |

One is "right to delete, wrong target"; this is "correct target, no right to delete." #1571 fixing its
aliasing does not close this authorization gap.

## The bug

An inbound network delete resolves the pair to the local entity and cleans it up unconditionally:

```ts
for (const entity of entitiesShouldBeCleaned) {
  for (const definition of engine.componentsIter()) {
    definition.entityDeleted(entity, true)     // clears every component, NetworkEntity included
  }
  engine.entityContainer.updateRemovedEntity(entity)
}
```

The sender is never compared to the entity's `networkId`. Under #1608 this is reached through the
"entity already exists" path, which returns before any ownership check.

## Who hits it

Any multiplayer scene. It also happens **by accident with no attacker and no modified client**: a scene
that calls `engine.removeEntity()` on an entity it *received* from a peer broadcasts a global
`DELETE_ENTITY_NETWORK` under the original owner's `networkId`, so an ordinary cleanup loop over
received entities destroys them for everyone. The owner is left with a local-only zombie: it can still
write to the handle and sees its own values change, but nothing syncs, and there is no error.

## What the scene does

`src/index.ts` gives a private `Engine()` a network transport, creates and syncs an entity it owns, then
delivers a `DELETE_ENTITY_NETWORK` for that entity **stamped from a different player's address**. It
reports the entity's state afterwards.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if a delete from a non-owner left the owner's entity `Removed`, green
if it was refused.

## Measured results

Headless, against `@dcl/sdk@7.26.0`, and unchanged against #1608's `dist`:

| | entity state after a non-owner's delete | still has its Transform |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **Removed** | no |
| with #1608 | Removed | no |

Identical rows: #1608 does not gate deletes of existing entities, so this stays open.

## What a fix would need

Restricting `DELETE_ENTITY_NETWORK` to the entity's owner — dropping the "already exists" short-circuit
for that one message type on the receive path. A destroy is inherently different from a write: a write
is naturally contested by the next write, a delete is not, which makes owner-only deletes the tractable
half. The one thing to check first is whether any real scene intends non-owners to destroy shared items
(consumable pickups); if so it wants an explicit opt-in on `syncEntity` rather than a blanket rule.

## Notes

The scene builds the delete with the same writer the SDK uses over comms (`DeleteEntityNetwork`).
Because there is no fix PR, the verdict is `ISSUE PRESENT` rather than a red/green flip; point the scene
at a build that enforces owner-only deletes and the entity will survive.
