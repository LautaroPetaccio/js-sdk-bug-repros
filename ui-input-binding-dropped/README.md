# uiInputBinding swallowed by the UI components

Reproduction scene for [js-sdk-toolchain#1579](https://github.com/decentraland/js-sdk-toolchain/pull/1579) —
_fix(react-ecs): apply uiInputBinding on Label, Button, Input and Dropdown_.

`uiInputBinding` is one of the props common to every UI component, but only `UiEntity` ever acted on it.
Set it on a `Label`, `Button`, `Input` or `Dropdown` and it disappears: no binding is created, and the
value ends up inside that component's own protobuf instead.

## The bug

`uiInputBinding` is declared on `EntityPropTypes`, alongside `uiTransform` and `uiBackground`:

```ts
export interface EntityPropTypes extends Listeners {
  uiTransform?: UiTransformProps
  uiBackground?: UiBackgroundProps
  /** Bind input actions to this element, held down while it's pressed (touch or pointer) */
  uiInputBinding?: PBUiInputBinding
  key?: Key
}
```

but the four wrapper components pull out only the props they know about and hand the rest to their own
component:

```tsx
const { uiTransform, uiBackground, onMouseDown, onMouseUp, onMouseEnter, onMouseLeave, ...otherProps } = props
const inputProps = parseUiInput(otherProps)   // uiInputBinding rode along in otherProps
```

## Who hits it

Anyone binding a key to a button, which is what the prop is for. It type-checks, because the prop really
is part of the component's type, so there is no warning at build time and nothing in world either. The
binding simply never happens, and the stray value is serialised into `PBUiText`, `PBUiInput` or
`PBUiDropdown` where nothing reads it.

`UiEntity` works, which is the confusing part: the same prop on the same screen behaves differently
depending on which component it is written on.

## What the scene does

`src/ui.tsx` renders one bare `UiEntity` and one of each wrapper component, all five asking for the same
binding. The `UiEntity` is the control, since it is the one component that has always worked.
`src/index.ts` counts the `UiInputBinding` components the engine ends up with and reports it against the
five that were asked for.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when fewer bindings exist than were asked for, green when all five do.

## Measured results

Headless, rendering those same five elements, against `@dcl/sdk@7.26.0` and then against the same
artifact with #1579 applied to the four components under `@dcl/react-ecs/dist/components`:

| | bindings created, of five asked for | where the value ended up instead |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **1** | `UiText` twice, `UiInput`, `UiDropdown` |
| with the fix | 5 | nowhere, it is a binding now |

The one that works on the released build is the bare `UiEntity`. `UiText` appears twice because both
`Label` and `Button` render text.

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

The JSX lives in `src/ui.tsx` because the scene entrypoint has to be `src/index.ts`.
