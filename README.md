# js-sdk-toolchain bug repros

Standalone Decentraland SDK7 scenes covering `@dcl/sdk` bugs, one scene per open pull request on
[decentraland/js-sdk-toolchain](https://github.com/decentraland/js-sdk-toolchain). Each folder is a
complete scene: `npm install && npm start`.

A scene is also the shortest way to exercise the platform a scene talks to, so the repo carries a
second, smaller set: [harness scenes](#harness-scenes) that drive a service rather than measure the
SDK.

| Scene | PR | Bug |
| --- | --- | --- |
| [`bytebuffer-sliced-growth`](bytebuffer-sliced-growth) | [#1460](https://github.com/decentraland/js-sdk-toolchain/pull/1460) | A `ReadWriteByteBuffer` built over a sliced array keeps the slice's `byteOffset` when it grows, so everything written after the growth lands past the end of what `toBinary()` returns. |
| [`observable-subscription-fallthrough`](observable-subscription-fallthrough) | [#1467](https://github.com/decentraland/js-sdk-toolchain/pull/1467) | The event-observable `switch` has no `break` in any case, so one subscription installs unrelated listeners and later subscriptions register duplicates. One enter-scene event notifies the observable twice. |
| [`tween-system-cache`](tween-system-cache) | [#1469](https://github.com/decentraland/js-sdk-toolchain/pull/1469) | Tween systems are cached by `engine._id`, which is a `Date.now()` timestamp, so two engines built in the same millisecond share one system and the second never sees its own tweens finish. |
| [`timer-callback-context`](timer-callback-context) | [#1470](https://github.com/decentraland/js-sdk-toolchain/pull/1470) | A throwing timer callback leaves the timer system's arm context set, so the next timer armed loses a whole frame. |
| [`react-ecs-entity-tracking`](react-ecs-entity-tracking) | [#1471](https://github.com/decentraland/js-sdk-toolchain/pull/1471) | The React reconciler never releases unmounted UI entity ids, so the tracking set grows for the lifetime of the scene and `destroy()` re-removes everything the UI ever mounted. |
| [`players-helper-tracking`](players-helper-tracking) | [#1512](https://github.com/decentraland/js-sdk-toolchain/pull/1512) | The players helper drops joins, resolves a duplicated address to the stale entity, compares addresses case-sensitively, hands out live component data, runs its tracker at the default system priority, and lets one throwing handler take down the rest. A 25-row check matrix rather than a single measurement. |
| [`players-helper-tracking-fixed`](players-helper-tracking-fixed) | [#1512](https://github.com/decentraland/js-sdk-toolchain/pull/1512) | The same matrix pinned to the published build of the PR branch, so it reports `FIXED: all 25 checks pass` with nothing to overlay. Same source file as the row above; the only difference is one line of `package.json`. |
| [`tween-dirty-serialization`](tween-dirty-serialization) | [#1477](https://github.com/decentraland/js-sdk-toolchain/pull/1477) | The tween cache system serialized every active tween every frame just to detect changes, allocating a 10 KiB buffer per tween. |
| [`crdt-network-entity-index`](crdt-network-entity-index) | [#1475](https://github.com/decentraland/js-sdk-toolchain/pull/1475) | Resolving an inbound network CRDT message scanned every NetworkEntity component, costing messages x synchronized entities. |
| [`crdt-zero-length-hang`](crdt-zero-length-hang) | [#1567](https://github.com/decentraland/js-sdk-toolchain/pull/1567) | A CRDT header claiming a length of 0 never advances the read cursor, so the parse loop re-reads it forever, and a known message type whose frame is shorter than its fields throws out of the transport. The chunk comes straight off the sync transport, so one malformed 8-byte packet from any peer freezes, or aborts the tick of, every participant of a multiplayer scene. |
| [`crdt-short-component-payload`](crdt-short-component-payload) | [#1597](https://github.com/decentraland/js-sdk-toolchain/pull/1597) | A well-framed component update whose payload is shorter than the schema needs makes the engine's deserialize run off the end of the buffer and throw out of engine.update, aborting the whole tick and every other message in the batch. Arrives from a peer over the sync transport; the payload-level sibling of #1567. |
| [`cyclic-parenting-hang`](cyclic-parenting-hang) | [#1568](https://github.com/decentraland/js-sdk-toolchain/pull/1568) | The cyclic parenting checker only recognises a loop that returns to the entity it started from, so a transform parented onto an existing cycle sends the walk round it forever and freezes the scene. |
| [`oneof-unset-crash`](oneof-unset-crash) | [#1570](https://github.com/decentraland/js-sdk-toolchain/pull/1570) | `Schemas.OneOf().create()` returns a value its own serializer cannot write, so a component with an unset OneOf field throws out of every engine update. |
| [`network-delete-wrong-entity`](network-delete-wrong-entity) | [#1571](https://github.com/decentraland/js-sdk-toolchain/pull/1571) | Deleting a synced entity drops the mapping before the message is converted for the renderer, so the renderer is told to delete the peer's id, which is a different live entity here. |
| [`input-across-entities`](input-across-entities) | [#1576](https://github.com/decentraland/js-sdk-toolchain/pull/1576) | The input scan stops on a button another entity already reported this frame, abandoning the rest of that entity's commands, so a key pressed over one entity is invisible outside it. |
| [`test-runner-stalls`](test-runner-stalls) | [#1575](https://github.com/decentraland/js-sdk-toolchain/pull/1575) | A failure thrown from a yielded function is never reported and escapes into `engine.update`, and a test that throws `undefined` stops every test scheduled after it. |
| [`pointer-event-entry-leak`](pointer-event-entry-leak) | [#1577](https://github.com/decentraland/js-sdk-toolchain/pull/1577) | Removing a pointer handler only drops its `PointerEvents` entry when it had a hover text, so entries outlive their handlers and pile up, and a proximity handler evicts a cursor one it cannot then remove. |
| [`button-disabled-color-fade`](button-disabled-color-fade) | [#1578](https://github.com/decentraland/js-sdk-toolchain/pull/1578) | A disabled `Button` halves the alpha of the colors it was given in place, so a palette the scene holds fades to nothing within a second and takes everything drawn with it along. |
| [`ui-input-binding-dropped`](ui-input-binding-dropped) | [#1579](https://github.com/decentraland/js-sdk-toolchain/pull/1579) | `uiInputBinding` is common to every UI component but only `UiEntity` acts on it, so a binding set on `Label`, `Button`, `Input` or `Dropdown` is swallowed into that component's own protobuf. |
| [`observable-alias-double-fire`](observable-alias-double-fire) | [#1580](https://github.com/decentraland/js-sdk-toolchain/pull/1580) | `onEnterScene` and `playerConnected` are two names for one subscription, but installation is gated per name, so subscribing to both installs the listener twice and every observer runs twice per event. |
| [`system-removal-skips-next`](system-removal-skips-next) | [#1581](https://github.com/decentraland/js-sdk-toolchain/pull/1581) | The update loop walks the live systems array, so a system that removes itself shifts the rest past the cursor and the next system misses that tick. |
| [`optional-falsy-dropped`](optional-falsy-dropped) | [#1582](https://github.com/decentraland/js-sdk-toolchain/pull/1582) | `Schemas.Optional` tests the value rather than its presence, so `false`, `0` and `''` are written as absent and read back as `undefined`. |
| [`asset-load-state-cap`](asset-load-state-cap) | [#1583](https://github.com/decentraland/js-sdk-toolchain/pull/1583) | Loading callbacks decide what is new by counting stored values, but the set evicts once full, so the count stops changing and every later event is dropped. |
| [`trigger-area-replay`](trigger-area-replay) | [#1584](https://github.com/decentraland/js-sdk-toolchain/pull/1584) | Removing the last trigger callback deletes the entity's consumed-events cursor, so the next handler registered is replayed the area's whole event history. |
| [`physics-force-clobber`](physics-force-clobber) | [#1585](https://github.com/decentraland/js-sdk-toolchain/pull/1585) | Applying a force to a source that already has a repulsion leaves the repulsion registered, and the per-tick recalculation overwrites the force on the next frame. |
| [`raycast-same-frame-removal`](raycast-same-frame-removal) | [#1586](https://github.com/decentraland/js-sdk-toolchain/pull/1586) | Raycast registration is delayed a frame to survive a same-frame removal, but the removal never cancels the queued registration, so a withdrawn raycast is installed a tick later. |
| [`composite-root-entity`](composite-root-entity) | [#1587](https://github.com/decentraland/js-sdk-toolchain/pull/1587) | Composite entity mapping tests entities for truthiness and `RootEntity` is 0, so instancing onto the root parents everything to a stray allocated entity. |
| [`react-ecs-input-lifecycle`](react-ecs-input-lifecycle) | [#1588](https://github.com/decentraland/js-sdk-toolchain/pull/1588) | `upsertComponent` deletes handlers from React's own props, so one dropped right after mount keeps firing, and the echo baseline ignores scene writes, so a restored value is swallowed. |
| [`deleted-entity-tombstones`](deleted-entity-tombstones) | [#1590](https://github.com/decentraland/js-sdk-toolchain/pull/1590) | Deleting an entity keeps its component timestamp forever, so the map only grows and every late joiner is sent a tombstone for each entity the scene ever deleted. |
| [`network-sender-spoof`](network-sender-spoof) | [#1608](https://github.com/decentraland/js-sdk-toolchain/pull/1608) (closed) | A network entity is named by `(networkId, entityId)` and the receiver creates one for any unseen pair, but `networkId` is written by the sender and never checked against the runtime-stamped address, so any peer can create entities under another player's identity. |
| [`network-entity-freeze`](network-entity-freeze) | open, no PR | A peer writing a synced component with the maximum LWW timestamp freezes it on every other client forever, and the owner's own counter overflows `uint32` back to 0 so everything it sends afterwards loses too. #1608 gates creation, not writes to an existing entity. |
| [`network-entity-delete-unauthorized`](network-entity-delete-unauthorized) | [#1615](https://github.com/decentraland/js-sdk-toolchain/pull/1615) | Any peer can delete any synced entity — on the owner's own client — because the receive path never checks the sender owns it; an honest scene's cleanup loop over received entities triggers it too. Distinct from #1571, which is renderer aliasing on an owner's own delete. |
| [`crdt-short-component-payload-authserver`](crdt-short-component-payload-authserver) | [#1612](https://github.com/decentraland/js-sdk-toolchain/pull/1612) | The `auth-server` variant of the row above. Clients there only accept CRDT from the authoritative server and the engine already catches the throw, so the original reports a clean run; the live defect is that the server's own validation drops an unreadable peer payload in silence and never answers the sender. Drives `createServerValidator`. |
| [`network-entity-delete-unauthorized-authserver`](network-entity-delete-unauthorized-authserver) | [#1615](https://github.com/decentraland/js-sdk-toolchain/pull/1615) | The `auth-server` variant of the row above. The engine there skips network messages, so the original's injection does nothing; a peer instead asks the server to delete, and `validateMessagePermissions` leaves entity deletion an empty branch, so the scene is never consulted. |
| [`network-entity-freeze-authserver`](network-entity-freeze-authserver) | open, no PR | The `auth-server` variant of `network-entity-freeze`. The engine there skips network messages, so the original's injection does nothing; a peer instead writes the maximum timestamp to the **server**, which takes it, relays it, and then refuses the real owner's updates as outdated — correcting the owner back to the attacker's value on every try. |

Every scene pins `@dcl/sdk@7.26.0`, the latest published release carrying all of these, and each
one measures its own symptom and prints a `BUG REPRODUCED` / `FIXED` verdict — in-world on a
`TextShape`, and on the console. Point a scene at a fixed SDK and the verdict flips; each README
covers how.

`players-helper-tracking` is the one exception to "one scene, one measurement": #1512 fixes eight
defects at once, so that scene reports a matrix and rolls it up. It also ships a headless runner
(`npm run verify`) for the two rows that need a host able to report an unhandled rejection.

`players-helper-tracking-fixed` is that same scene pinned to a CI build of the PR branch, so the
flipped verdict can be reproduced without building the toolchain. Its `src/checks.ts` is a verbatim
copy — each folder here has to stand alone — and `npm run check-sync` fails if the two drift.

Requires Node >= 20.

## Harness scenes

These are not `@dcl/sdk` bugs. They send real requests at a Decentraland service from inside a
scene, because that is the only place the request can originate, and report what came back — so
where one of them does reach a verdict, it is about the service it reached, not about an SDK
version. For the same reason they pin whichever SDK build the service expects rather than the
`7.26.0` above. They need a live explorer, so they cannot be run headlessly.

| Scene | PR | What it drives |
| --- | --- | --- |
| [`auth-canonical-signature-params`](auth-canonical-signature-params) | [auth#463](https://github.com/decentraland/auth/pull/463) | Fifteen buttons, one per signature-request param shape, sent through the explorer's web3 API to the auth site. Three are the canonical shapes it accepts; the rest are the shapes the new params guard rejects, including the two-payload request that previews one typed-data payload and hands the wallet another. |
| [`authoritative-preview-handshake`](authoritative-preview-handshake) | [comms-gatekeeper#294](https://github.com/decentraland/comms-gatekeeper/pull/294) | Whether a local preview's client and the authoritative server `sdk-commands start` spawns were handed the same comms-gatekeeper room. The two ask different endpoints and never discover each other, so a mismatch loads the scene and silently never syncs; the scene reports comms connection, state sync and a two-way CRDT plus message-bus round trip, and names which of the three failed. |

## Layout

Each folder is an ordinary scene created from the SDK7 template:

```
<scene>/
  package.json     pinned @dcl/sdk, standard start/build/deploy scripts
  scene.json       single 0,0 parcel, spawn point aimed at the readout
  src/index.ts     the repro
  README.md        the bug, how to run it, and the measured numbers
```

## How the numbers were measured

The figures in each README come from running the built scene bundle in the QuickJS scene runtime with
a scripted renderer, which makes frame timing and inbound CRDT deterministic. That is also why the
numbers are exact rather than approximate: they are not read off a live explorer. Each README states
which parts were observed headlessly and which depend on the host's frame timing.
