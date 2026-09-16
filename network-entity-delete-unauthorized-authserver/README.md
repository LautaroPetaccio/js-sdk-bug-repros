# a peer deleting an entity it did not create

Auth-server variant of [`network-entity-delete-unauthorized`](../network-entity-delete-unauthorized).
Reproduction scene for [js-sdk-toolchain#1615](https://github.com/decentraland/js-sdk-toolchain/pull/1615).

## Why a separate scene

The original injects `DELETE_ENTITY_NETWORK` into a private engine. On the `auth-server` branch the
engine skips network messages rather than reading them, so that injection does nothing at all:

```
DELETE_ENTITY_NETWORK -> threw: no | mappings: 0
```

The original therefore reports the entity surviving — for the wrong reason. A peer here cannot reach
another client's engine directly; it asks the **server** to delete, and the server decides. That is
the seam this scene drives.

## The bug

`validateMessagePermissions` routes component writes through the per-component `validateBeforeChange`
hook, and leaves deletion as an empty branch:

```ts
if (message.type === CrdtMessageType.DELETE_ENTITY) {
  // TODO: how to handle this case ?
}
```

so a delete falls through to the unconditional `return true`. Any peer can destroy any synced entity,
and the scene is never asked.

Owner-only would be the wrong fix on its own — it forbids picking up an item another player dropped.
The scene knows which of its entities are shared and which are not, and it already receives
`senderAddress` and `createdBy`; it just was not consulted.

## What the scene does

1. `0xOWNER` announces an entity, so the server records it as the creator.
2. The scene registers an owner-only rule through `validateBeforeChange`.
3. `0xSOMEONE-ELSE` asks the server to delete that entity.
4. The scene reports whether the entity survived and whether the delete reached the room.

On a build that never asks, the rule in step 2 is registered and simply never runs.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the entity was destroyed on a stranger's word, green if the scene
was asked and refused.

## Measured results

Headless, against the pinned `auth-server` build and then the same steps with #1615 applied:

| | entity survived | delete relayed to the room |
| --- | --- | --- |
| `7.28.1-…commit-7d0808b` | **no** | **yes** |
| with #1615 | yes | no |

## Notes

This pins a CI build of the `auth-server` branch rather than a published release, because
`@dcl/sdk/network/server` does not exist on `main` and there is no release carrying it yet.

The scene asserts only that the scene is consulted. What the default should be when a scene registers
no validator is a separate decision, and #1615 deliberately leaves it as "allow", so this scene
registers a rule explicitly rather than relying on one.
