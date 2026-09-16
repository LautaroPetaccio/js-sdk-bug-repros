# an unreadable peer payload, dropped in silence

Auth-server variant of [`crdt-short-component-payload`](../crdt-short-component-payload). Reproduction
scene for [js-sdk-toolchain#1612](https://github.com/decentraland/js-sdk-toolchain/pull/1612).

## Why a separate scene

The original drives a truncated `PUT_COMPONENT` into a private engine, because on `main` that is where
a peer's bytes land. On the `auth-server` branch it is not: clients only accept CRDT from the
authoritative server, and the engine already wraps `updateFromCrdt` in a `try/catch`. Run the original
there and it reports a clean result while the defect is live:

```
truncated PUT_COMPONENT -> engine.update aborted: no
```

The seam that matters on this branch is the server's own validation, so this scene drives
`createServerValidator` instead. The bytes are identical; only what consumes them changes.

## The bug

A peer chooses both the component id and the payload. On the server's validation path, `getComponent`
throws for an id this engine never defined, `schema.deserialize` throws for a payload shorter than the
schema, and `convertNetworkToRegularMessage` returns `null` when conversion fails — which the caller
passed straight on and dereferenced.

All three land in the per-message `catch` in `processServerMessages`, which logs only under
`DEBUG_NETWORK_MESSAGES`. So the update is dropped **in silence**, and because validation never
returned a verdict, the sender is never sent the authoritative correction an invalid message is
supposed to produce. The peer keeps applying state the server rejected, with nothing to tell it
otherwise.

## What the scene does

`src/index.ts` gives a private `Engine()` a `createServerValidator`, feeding its output back through a
transport the way the sync layer does — which matters, because a correction can only exist once the
server holds state to correct to.

1. A peer sends a good `GltfContainer` for entity `900`, which the server takes.
2. The same peer sends a truncated one for the same entity.
3. The scene reports whether the server survived, whether it relayed the bad update, and whether it
   answered the sender.

`GltfContainer` rather than `Transform` on purpose: converting a Transform runs `fixTransformParent`,
which deserializes and throws earlier, so a Transform exercises a different guard.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the update was dropped without answering the sender, green if the
sender was sent the server's authoritative state.

## Measured results

Headless, against the pinned `auth-server` build and then the same steps with #1612 applied:

| | survived | relayed to the room | answered the sender |
| --- | --- | --- | --- |
| `7.28.1-…commit-7d0808b` | yes | no | **no** |
| with #1612 | yes | no | yes |

The middle column is the control: an unreadable payload must not reach other peers either way. The
difference is the third — today the sender learns nothing.

## Notes

This pins a CI build of the `auth-server` branch rather than a published release, because
`@dcl/sdk/network/server` does not exist on `main` and there is no release carrying it yet. To move to
a build with the fix:

```bash
npm view @dcl/sdk versions        # find 7.28.x-<runId>.commit-<sha7> for #1612's head
npm install --save-dev @dcl/sdk@7.28.x-<runId>.commit-<sha7>
npm run build && npm start
```
