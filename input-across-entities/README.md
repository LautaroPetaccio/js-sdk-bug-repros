# one entity's input hiding another's

Reproduction scene for [js-sdk-toolchain#1576](https://github.com/decentraland/js-sdk-toolchain/pull/1576) —
_fix(ecs): stop one entity's input hiding another's in the same frame_.

A key pressed over one entity is lost when a **different** entity reports a newer input in the same
frame. `isPressed` and the global `isTriggered` both answer `false`, while the per-entity `isTriggered`
still answers `true` for the very same press.

## The bug

`packages/@dcl/ecs/src/engine/input.ts` walks each entity's commands newest first and stops as soon as
it meets one that is not newer than what the button state already holds:

```ts
if (command.state === PointerEventType.PET_UP || command.state === PointerEventType.PET_DOWN) {
  const prevCommand = globalState.buttonState.get(command.button)
  if (!prevCommand || command.timestamp > prevCommand.timestamp) {
    globalState.buttonState.set(command.button, command)
  } else {
    // since we are iterating a descending array, we can early finish the
    // loop
    break
  }
}
```

The comment is right about the array and wrong about the state. `buttonState` is global and shared
between entities, so the entry being compared against is often one that an entity processed **earlier
in the same frame** put there. The `break` then abandons the current entity's remaining commands — and
those are not only for the same button, they are for every other button too.

## Who hits it

Timestamps are one counter shared by every entity, so any frame carrying input from two entities can
interleave. Release the pointer over one object while a key goes down over another and the key press
disappears from the global input state. Which entity happens to be iterated first decides whether the
input registers at all, and entity iteration order is not something a scene controls.

## What the scene does

`src/index.ts` writes the pointer results itself on a private `Engine()`, which is what the renderer
normally does, so the frame is exactly reproducible:

| entity | timestamp | event |
| --- | --- | --- |
| clicked entity | 3 | `IA_POINTER` up |
| other entity | 1 | `IA_PRIMARY` down |
| other entity | 2 | `IA_POINTER` down |

The key press is the oldest of the three, which puts it behind the early exit. After one update the
scene reads the same three questions a scene would ask.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the press is visible on its own entity but not globally, green
when it is visible everywhere.

## Measured results

Headless, feeding that exact frame, against `@dcl/sdk@7.26.0` and then against the same artifact with
#1576's frame-boundary exit applied to `@dcl/ecs/dist/engine/input.js`:

| | `isPressed(IA_PRIMARY)` | `isTriggered(IA_PRIMARY, PET_DOWN)` | same, on its own entity |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | **false** | **false** | true |
| with the fix | true | true | true |

The third column is what makes this hard to diagnose in a real scene: the press is not missing, it is
readable from the entity that received it and invisible everywhere else.

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

`createInputSystem` and the per-engine `PointerEventsResult` factory live under `@dcl/ecs/dist/...` and
are not re-exported from `@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in
`package.json`. The scene uses its own engine rather than the scene engine so the input it writes is
the only input in the frame.
