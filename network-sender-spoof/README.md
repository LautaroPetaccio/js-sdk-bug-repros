# a peer creating an entity under another player's networkId

Reproduction scene for [js-sdk-toolchain#1608](https://github.com/decentraland/js-sdk-toolchain/pull/1608) —
_fix: only let a peer create network entities in its own id space_.

A network entity is named by the pair `(networkId, entityId)`. When a client receives a message for a
pair it has never seen, it creates a local entity for it. Nothing checks that the peer who sent the
message was entitled to that `networkId`, so **any peer can create entities under any other player's
identity**.

## The bug

`networkId` is written into the message by the sender. It is a deterministic, public hash of the
sender's wallet address (`componentNumberFromName(address)`), so every client can compute every other
player's `networkId`. On the receive path the field is taken at face value:

```ts
if (networkUtils.isNetworkMessage(msg) && !network) {
  entityId = engine.addEntity()
  network = { entityId: msg.entityId, networkId: msg.networkId }  // msg.networkId is whatever the sender wrote
  NetworkEntity.createOrReplace(entityId, network)
}
```

The runtime already stamps the *authenticated* address a comms message arrived from — the one field a
peer cannot forge — but the sync transport decoded it and threw it away one line before the engine.
#1608 threads it through and requires a created entity's `networkId` to match the stamped sender.

## Who hits it

Any multiplayer scene, and no exotic timing: entity ids are not per-player, so a victim's first entity
is `512` on every client, knowable before they use it. An attacker can **pre-declare** `(victim, 512)`
so the victim's real entity merges into the attacker's when they finally create it, inheriting whatever
components the attacker attached — and those entities carry the victim's `networkId`, so any scene logic
that reads ownership blames the wrong player.

## What the scene does

`src/index.ts` gives a private `Engine()` a network transport, then delivers two messages both stamped
from the attacker's address:

1. the attacker announcing an entity `777` under **its own** `networkId` — legitimate, must be accepted;
2. the attacker announcing entity `512` under the **victim's** `networkId` — the spoof.

It reports which of the two produced a local `NetworkEntity` mapping. The published SDK's `onmessage`
takes only the bytes, so the stamped sender is ignored and both are accepted; the fix reads the sender
and refuses the second.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the spoofed announcement created an entity under the victim's
identity, green if only the attacker's own entity was created.

## Measured results

Headless, against `@dcl/sdk@7.26.0` and then against the same steps with #1608's `dist`:

| | attacker's own entity mapped | spoofed victim-owned entity mapped |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | yes | **yes** — created under the victim's networkId |
| with #1608 | yes | no — refused |

The first column is the control: the fix is surgical, an honest announcement in the peer's own id space
is untouched.

## Re-testing against the fix

Each CI build of a branch publishes a version tagged with its commit:

```bash
npm view @dcl/sdk versions        # find 7.26.x-<runId>.commit-<sha7> for #1608's head
npm install --save-dev @dcl/sdk@7.26.x-<runId>.commit-<sha7>
npm run build && npm start
```

Once the fix lands on `main`, `npm run upgrade-sdk:next`.

## Notes

The scene passes the stamped sender as a second argument to `onmessage`, which is exactly what the fixed
`message-bus-sync` does with `senderIdentity(sender)` — the published SDK simply ignores the extra
argument, which is why the same scene reproduces on `7.26.0` and flips on the fix. The message writers
(`PutNetworkComponentOperation`) and the `Transport` type live under `@dcl/ecs/dist/...` and are not
re-exported from `@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned alongside `@dcl/sdk`.

This closes entity *creation* under a forged identity. It does not bound how many entities a peer may
create under its **own** identity (entity exhaustion), nor does it stop writes to or deletes of entities
that already exist — see the sibling scenes `network-entity-freeze` and
`network-entity-delete-unauthorized`.
