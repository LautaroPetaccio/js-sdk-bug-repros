# an Input handler that will not stop, and a value that will not land

Reproduction scene for [js-sdk-toolchain#1588](https://github.com/decentraland/js-sdk-toolchain/pull/1588) —
_fix(react-ecs): keep input props and their echo baseline honest_.

Two faults in the same function, both around `Input`. A handler removed on the render right after mount
keeps firing, and a value the scene restores after clearing the field never reaches it.

## The bug

`packages/@dcl/react-ecs/src/reconciler/index.ts`, in `upsertComponent`:

```ts
delete (props as any).onChange
delete (props as any).onSubmit
```

On the create path that object is the element's live props. The next diff therefore finds no `onChange`
in the *old* props, so dropping the handler on the very next render emits no change at all and the old
callback stays wired.

And the echo baseline:

```ts
if (
  componentName === 'uiInput' &&
  'value' in props &&
  lastInputResultValues.has(instance.entity) &&
  (props as any).value === lastInputResultValues.get(instance.entity)
) {
  delete (props as any).value
}
```

`lastInputResultValues` is only ever written from the renderer's side. A value the scene pushes itself
leaves it pointing at something older, so pushing back to that older value looks like an echo and is
dropped.

## Who hits it

The first shows up wherever a handler is conditional:

```tsx
<Input {...(editing ? { onChange: handler } : {})} />
```

Turn `editing` off and `handler` still runs on the next keystroke. Only the render straight after mount
is affected, which is what makes it look intermittent.

The second is the chat box shape: the player types, the scene sends the message and clears the field,
then a "repeat last" control puts the text back and nothing happens.

## What the scene does

`src/ui.tsx` renders two fields. The first stops rendering its `onChange` after a frame, and the scene
then simulates the player typing into it, counting how many times the handler that is no longer rendered
runs. The second is driven through the full cycle: the player types, React echoes it back, the scene
clears the field, and the scene restores what was typed. The scene then reads what the field actually
holds.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when the dropped handler fires or the restored value is missing, green
when neither happens.

## Measured results

Headless, both sequences against `@dcl/sdk@7.26.0` and then against the same artifact with #1588 applied
to `@dcl/react-ecs/dist/reconciler/index.js`:

| | dropped handler called | field after restoring |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **1** | **`""`** |
| with the fix | 0 | `"gm"` |

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

The echo suppression still exists and still works: writing back the exact value the renderer just
reported is dropped, which is what keeps a fast typist's keystrokes from being clobbered. The PR notes a
remaining limitation, where a scene changing its state twice between two renders can still have the
resulting diff mistaken for an echo.

The JSX lives in `src/ui.tsx` because the scene entrypoint has to be `src/index.ts`.
