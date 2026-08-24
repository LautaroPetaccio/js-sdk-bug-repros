# js-sdk-toolchain bug repros

Standalone Decentraland SDK7 scenes that reproduce three `@dcl/sdk` bugs, one scene per open pull
request on [decentraland/js-sdk-toolchain](https://github.com/decentraland/js-sdk-toolchain). Each
folder is a complete scene: `npm install && npm start`.

| Scene | PR | Bug |
| --- | --- | --- |
| [`observable-subscription-fallthrough`](observable-subscription-fallthrough) | [#1467](https://github.com/decentraland/js-sdk-toolchain/pull/1467) | The event-observable `switch` has no `break` in any case, so one subscription installs unrelated listeners and later subscriptions register duplicates. One enter-scene event notifies the observable twice. |
| [`timer-callback-context`](timer-callback-context) | [#1470](https://github.com/decentraland/js-sdk-toolchain/pull/1470) | A throwing timer callback leaves the timer system's arm context set forever, so every timer armed afterwards fires late. |
| [`react-ecs-entity-tracking`](react-ecs-entity-tracking) | [#1471](https://github.com/decentraland/js-sdk-toolchain/pull/1471) | The React reconciler never releases unmounted UI entity ids, so the tracking set grows for the lifetime of the scene and `destroy()` re-removes everything the UI ever mounted. |

Every scene pins `@dcl/sdk@7.26.0`, the latest published release carrying all three bugs, and each
one measures its own symptom and prints a `BUG REPRODUCED` / `FIXED` verdict — in-world on a
`TextShape`, and on the console. Point a scene at a fixed SDK and the verdict flips; each README
covers how.

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
