# pointer event entries outliving their handlers

Reproduction scene for [js-sdk-toolchain#1577](https://github.com/decentraland/js-sdk-toolchain/pull/1577) —
_fix(ecs): keep pointer event entries in step with their handlers_.

Registering a pointer handler always adds an entry to the entity's `PointerEvents` component, but
removing one only takes an entry away if the handler was given a `hoverText`. Everything else leaves the
entry behind, so the renderer keeps offering an interaction that nothing listens to, and re-registering
piles another entry on top every time.

## The bug

`packages/@dcl/ecs/src/systems/events.ts`:

```ts
function removeEvent(entity: Entity, type: EventType, interactionType: InteractionType = InteractionType.CURSOR) {
  const event = getEvent(entity)
  const pointerEvent = event.get(type)

  if (pointerEvent?.opts.hoverText) {
    removePointerEvent(entity, getPointerEvent(type), pointerEvent.opts.button)
  }

  event.delete(type)
}
```

Three separate problems live in those few lines:

1. The removal is gated on `hoverText`, but `setPointerEvent` adds an entry unconditionally.
2. `interactionType` is accepted and never forwarded, so removal always filters against `CURSOR` and a
   proximity entry can never be taken away.
3. The callback map is keyed by event type alone, while the component keys its entries by event type
   **and** interaction type, so `onProximityDown` evicts whatever `onPointerDown` left in that slot.

## Who hits it

Anything that adds and drops handlers as state changes, which is what React UI does on every render.
`onMouseDown` and friends are registered with no `hoverText`, so none of their entries are ever removed:
a `Button` toggled between enabled and disabled five times ends up carrying six `PET_DOWN` entries, and
a disabled one still advertises the interaction, keeping its hover feedback and swallowing the pointer.

The component is re-sent over CRDT whenever it changes, so the growing array is shipped to the renderer
again on each toggle.

## What the scene does

`src/index.ts` drives a private engine with its own pointer events system and reads the component back:

1. Registers one handler with no hover text, removes it, then runs five add-and-remove cycles, counting
   the entries left after each stage.
2. On a second entity, registers a cursor handler and then a proximity handler, checks whether the
   cursor one survived, removes the proximity handler and checks whether its entry went away.

A private engine is what makes the counts readable: the scene needs to inspect the same component the
renderer would receive.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when entries outlive their handlers, green when they come and go
together.

## Measured results

Headless, driving the same two measurements, against `@dcl/sdk@7.26.0` and then against the same
artifact with #1577 applied to `@dcl/ecs/dist/systems/events.js`:

| | after removing the handler | after five add/remove cycles | described after cursor + proximity | left after removing proximity |
| --- | --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | **1** | **6** | `["proximity"]` | `["proximity"]` |
| with the fix | 0 | 0 | `["cursor","proximity"]` | `["cursor"]` |

The third column is the collision: on the released build, registering a proximity handler deletes the
cursor entry outright and evicts its callback. The fourth is the mirror image, the proximity entry that
cannot be removed.

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

`PBPointerEventsResult` carries no interaction type, so once both handlers survive registration the SDK
cannot tell which interaction produced a `PET_DOWN` and runs both. That is the deliberate trade in
#1577: previously one of the two registrations was discarded without a word.

`createPointerEventsSystem`, `createInputSystem` and the per-engine `PointerEvents` factory live under
`@dcl/ecs/dist/...` and are not re-exported from `@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned
alongside `@dcl/sdk` in `package.json`.
