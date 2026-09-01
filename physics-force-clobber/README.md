# a repulsion undoing the force applied after it

Reproduction scene for [js-sdk-toolchain#1585](https://github.com/decentraland/js-sdk-toolchain/pull/1585) —
_fix(ecs): let a plain force replace a repulsion from the same source_.

Apply a repulsion to the player from some source, then apply an ordinary force from that same source. The
force takes effect, and then the repulsion silently takes it back on the next tick.

## The bug

`packages/@dcl/ecs/src/systems/physics-force.ts` records the new force and nothing else:

```ts
forceSources.set(source, finalVector)
recalcForce()
```

The repulsion registered for that same source is still there, and the background system recomputes every
repulsion each tick and writes it back over the top:

```ts
for (const [source, { fromPosition, magnitude, radius, falloff }] of repulsionSources) {
  const vector = computeRepulsionVector(...)
  if (vector) forceSources.set(source, vector)
```

So the scene's force lives for the rest of the frame and is gone by the next one. The helpers document
that calling one again with the same source replaces that source's previous force; this is the one
combination where it does not.

## Who hits it

A source that does both, which is the natural way to build one: an explosion that knocks players away
and then, a moment later, applies a lift or a push in a fixed direction. `applyForceToPlayerForDuration`
goes through the same code path, so a timed force over a repulsion is undone the same way.

The symptom is the confusing part. The force is visibly applied, so a quick check in the console shows
the right value, and only movement over the following frames reveals it never took.

## What the scene does

`src/index.ts` applies a knockback away from the origin, immediately replaces it with a straight upward
force from the same source, and reads the player's combined force twice: right after applying, and a few
ticks later. The first read is the control that shows the call did land.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the force reverts, green when it stays.

## Measured results

Headless, the same two calls against `@dcl/sdk@7.26.0` and then against the same artifact with #1585
applied to `@dcl/ecs/dist/systems/physics-force.js`:

| | right after applying | three ticks later |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | `(0, 7, 0)` | **`(5, 0, 0)`**, the repulsion again |
| with the fix | `(0, 7, 0)` | `(0, 7, 0)` |

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

Repulsions that are not replaced still recalculate every tick as the player moves, which is the whole
point of them. Only a source whose force has been explicitly replaced stops being recomputed.
