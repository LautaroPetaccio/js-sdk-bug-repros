# a self-removing system skipping the next one

Reproduction scene for [js-sdk-toolchain#1581](https://github.com/decentraland/js-sdk-toolchain/pull/1581) —
_fix(ecs): stop a removed system skipping the next one_.

A system that removes itself, which is the documented way to write a one-shot system, makes the system
that comes after it miss that tick entirely.

## The bug

`packages/@dcl/ecs/src/engine/index.ts` walks the live array:

```ts
for (const system of partialEngine.getSystems()) {
  const ret = system.fn(dt)
```

and `removeSystem` splices that same array:

```ts
systems.splice(index, 1)
```

`for...of` over an array walks by index, so removing the entry the loop is standing on shifts every later
system down one, past the cursor. Exactly one system is skipped, and only for that tick, which is what
makes it hard to catch: the next frame looks fine.

## Who hits it

The one-shot pattern is the trigger, and it is the recommended one:

```ts
function initOnce() {
  doSomething()
  engine.removeSystem(initOnce)
}
engine.addSystem(initOnce)
```

`@dcl/sdk`'s own `sleep` helper is written this way, so any scene awaiting it removes a system mid-tick
without knowing. Whichever system sits next in priority order silently loses a frame.

## What the scene does

`src/index.ts` builds a private engine with three systems at descending priorities, where the first
removes itself, then runs two ticks and reports which systems ran on each. The second tick is the
control: it shows the remaining two behave normally once the removal has settled, so the missing system
on the first tick cannot be blamed on the priorities.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when a system is missing from the first tick, green when all three ran.

## Measured results

Headless, the same three systems and two ticks, against `@dcl/sdk@7.26.0` and then against the same
artifact with #1581 applied to `@dcl/ecs/dist/engine/{systems,index}.js`:

| | tick where the one-shot removed itself | next tick |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | `one-shot, third` | `second, third` |
| with the fix | `one-shot, second, third` | `second, third` |

`second` is the one that disappears, and it is back the following frame, which is why this reads as an
intermittent glitch rather than a broken system.

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

The fix keeps the other half of the old behaviour: a system removed part-way through a tick still does
not run that tick. Only the accidental skipping of an unrelated system goes away.
