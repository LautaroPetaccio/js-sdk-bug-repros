# crdt network entity index

Test scene for [js-sdk-toolchain#1475](https://github.com/decentraland/js-sdk-toolchain/pull/1475) —
_perf: index CRDT network entities_.

## The change

Resolving an inbound network CRDT message to its local entity scanned **every** `NetworkEntity`
component, so the update path cost `messages x synchronized entities`. The PR keeps a map keyed by
`(networkId, entityId)` and resolves in constant time.

## What the scene does

400 entities, each registered with `syncEntity(entity, [Transform.componentId], id)`. 40 of them are
mutated every frame so outgoing CRDT traffic keeps flowing and peers keep sending updates back.
Two bracketing systems — one at `Number.MAX_VALUE`, one at `Number.MIN_SAFE_INTEGER` — measure the
wall time the SDK's systems consume per frame. After 60 warm-up frames it averages 300 and reports
on a `TextShape` at `8,4,8`:

```
crdt network entity index
synced entities created here: 400
entities received from peers: N
avg frame: X.XX ms   worst: X.XX ms
INBOUND TRAFFIC OBSERVED: this measurement exercises entity resolution
```

## It needs two clients

Entity resolution only runs for **inbound** messages, so a single client measures nothing relevant.
The scene detects this and says `SOLO` rather than reporting a misleading number.

```bash
npm install
npm start -- --multi-instance    # then join the same scene from the second client
```

With one client running you should see `entities received from peers: 0` and the `SOLO` line. With
two, the peer count becomes non-zero and the frame average covers the resolution path.

## Measured off-scene

Resolution was also benchmarked directly, driving inbound messages into the engine so only the
lookup is counted. Messages target the last synced entity — worst case for the old scan:

| synced entities | messages/frame | main | PR |
| --- | --- | --- | --- |
| 100 | 20 | 1.12 ms/frame | 0.27 ms/frame |
| 500 | 50 | 7.82 ms/frame | 0.34 ms/frame |
| 1 000 | 100 | **31.81 ms/frame** | **0.49 ms/frame** |

Quadrupling the work takes `main` from 7.8 to 31.8 ms — almost exactly 4x, confirming the
`messages x entities` cost — while the PR goes 0.34 to 0.49 ms. At the bottom row `main` spends
about two 60 fps frames per frame on entity resolution alone.

## What to check for regressions

`entities received from peers` should be non-zero with two clients and the boxes should move on
both. The index is only correct if resolution keeps landing on the right local entity; a broken
mapping shows up as boxes that stop tracking, or peer entities that never appear.
