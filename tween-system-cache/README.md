# tween systems shared between engines

Reproduction scene for [js-sdk-toolchain#1469](https://github.com/decentraland/js-sdk-toolchain/pull/1469) —
_fix: cache tween systems by engine identity_.

Tween systems are cached by `engine._id`, and engine ids come from `Date.now()`. Two engines built in the
same millisecond therefore get **one** tween system between them — the second engine receives a system
wired to the first engine's components, so its own tweens are never tracked and never report completion.

## The bug

`packages/@dcl/ecs/src/systems/tween.ts`:

```ts
const cacheTween: Map<number, TweenSystem> = new Map()

export function createTweenSystem(engine: IEngine): TweenSystem {
  if (cacheTween.has(engine._id)) {
    return cacheTween.get(engine._id)!
  }
  const Tween = components.Tween(engine)
  ...
  cacheTween.set(engine._id, tweenSystem)
```

`_id` is `Date.now()` at construction, so the key is a timestamp, not an identity. On a cache hit the
second engine is handed a system that closed over the *first* engine's `Tween`, `TweenState` and
`TweenSequence` definitions, and whose bookkeeping systems were registered on the first engine with
`engine.addSystem`. The second engine ends up with no tween systems at all, and its private completion
cache is never populated — so `tweenCompleted()` answers `false` for every tween it runs.

The strong `Map` is the other half: it holds every tween system, and through the closure every engine,
for the lifetime of the process. The fix keys a `WeakMap` on the engine object itself, which fixes both.

## Who hits it

A scene has exactly one engine, so ordinary scene code never collides. Extra engines come from tooling —
the inspector, testing harnesses, anything that builds an engine per fixture — and from scene code that
constructs its own. The collision needs nothing exotic: two `Engine()` calls in the same millisecond,
which is what happens when they are adjacent statements.

## What the scene does

`src/index.ts`:

1. Builds pairs of engines until two share an `_id`, which is normally the first pair.
2. Calls `createTweenSystem` on each and compares the two by identity.
3. Puts a `Tween` and an active `TweenState` on an entity of the **second** engine.
4. Runs both engines for three frames, so a healthy tween system has time to notice the tween and settle.
5. Flips that `TweenState` to `TS_COMPLETED`, the way a renderer reports a finished tween, and immediately
   asks `tweenCompleted()`.

Step 5 asks before the tween system's own bookkeeping runs again on purpose: completion is reported once
per tween, and the system's internal pass consumes that edge. A scene reading it from its own system sees
it at the same point.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White for the three warm-up frames, then red when the bug reproduces and
green when each engine keeps its own system.

## Measured results

Run headlessly against `@dcl/sdk@7.26.0`, and then against the same artifact with PR #1469's `WeakMap`
applied to `@dcl/ecs/dist/systems/tween.js`:

| | ids collided | second engine got the first's system | completed tween reported |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | yes | **yes** | **no** |
| with the fix | yes | no | yes |

Both rows collide on the first pair of engines, so the fixed row is not passing by dodging the collision —
it is the cache telling the two engines apart.

If the sign reads `INCONCLUSIVE`, no pair shared an id in 200 attempts and the cache was never asked to
collide; the result says nothing about the bug either way.

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

The per-engine component factories (`Tween(engine)`, `TweenState(engine)`) are typed under
`@dcl/ecs/dist/components` but not re-exported from `@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned
alongside `@dcl/sdk` in `package.json`. `TweenStateStatus` ships as a `const enum`, which cannot be
imported at runtime, so the scene spells out the two values it needs.
