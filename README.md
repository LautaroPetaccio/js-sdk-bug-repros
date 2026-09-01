# js-sdk-toolchain bug repros

Standalone Decentraland SDK7 scenes covering `@dcl/sdk` bugs, one scene per open pull request on
[decentraland/js-sdk-toolchain](https://github.com/decentraland/js-sdk-toolchain). Each folder is a
complete scene: `npm install && npm start`.

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
| [`crdt-zero-length-hang`](crdt-zero-length-hang) | [#1567](https://github.com/decentraland/js-sdk-toolchain/pull/1567) | A CRDT header claiming a length of 0 never advances the read cursor, so the parse loop re-reads it forever. The chunk comes straight off a transport, so one malformed 8-byte packet from any peer freezes every scene in the room. |
| [`cyclic-parenting-hang`](cyclic-parenting-hang) | [#1568](https://github.com/decentraland/js-sdk-toolchain/pull/1568) | The cyclic parenting checker only recognises a loop that returns to the entity it started from, so a transform parented onto an existing cycle sends the walk round it forever and freezes the scene. |
| [`oneof-unset-crash`](oneof-unset-crash) | [#1570](https://github.com/decentraland/js-sdk-toolchain/pull/1570) | `Schemas.OneOf().create()` returns a value its own serializer cannot write, so a component with an unset OneOf field throws out of every engine update. |

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
