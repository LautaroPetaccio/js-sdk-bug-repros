# a disabled Button fading the scene's own palette

Reproduction scene for [js-sdk-toolchain#1578](https://github.com/decentraland/js-sdk-toolchain/pull/1578) —
_fix(react-ecs): stop a disabled Button dimming the scene's own colors_.

A disabled `Button` dims itself by halving the alpha of its colors **in place**. Those colors are still
the objects the scene passed in, and UI re-renders every frame, so the scene's own value is halved again
and again until everything drawn with it is invisible.

## The bug

`packages/@dcl/react-ecs/src/components/Button/index.tsx`:

```tsx
if (!!props.disabled) {
  if (textProps.color) textProps.color.a /= 2
  if (uiBackgroundProps && uiBackgroundProps.color) uiBackgroundProps.color.a /= 2
}
```

`textProps` and `uiBackgroundProps` are shallow copies:

```tsx
const textProps: PBUiText = { ...buttonProps.uiText, ...uiTexProps, ... }
const uiBackgroundProps = parseUiBackground({ ...buttonProps.uiBackground, ...uiBackground })
```

so `.color` is the caller's object, not a copy of it. The dimming is also not idempotent: it compounds
against whatever the previous render left behind.

## Who hits it

Any scene that keeps its colors in a variable, which is the normal way to hold a palette:

```tsx
const BRAND = Color4.White()
<Button value="press" disabled color={BRAND} uiBackground={{ color: BRAND }} />
```

Everything else drawn with `BRAND` fades along with the button, because they are all one object. A scene
that builds its colors inline inside the render function is accidentally safe, since each render makes a
fresh object, which is why this survives casual use.

## What the scene does

`src/ui.tsx` holds a two-entry palette. One entry goes to a disabled `Button` and to a `Label`; the other
is used by a second `Label` and never goes near the button. `src/index.ts` renders that panel and reports
the alpha of both entries on an in-world sign, so the fading entry can be read against the one that is
left alone.

In world the panel shows it directly: the button and the label sharing the entry disappear within a
second while the third label stays put.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8` and look at the UI panel. Red once the palette entry the button was given has
drifted from where the scene set it, green when it has not.

## Measured results

Headless, rendering a disabled button for six frames with one palette entry passed as both its text and
its background color, against `@dcl/sdk@7.26.0` and then against the same artifact with #1578 applied to
`@dcl/react-ecs/dist/components/Button/index.js`:

| | alpha of the scene's color after six frames |
| --- | --- |
| `@dcl/sdk@7.26.0` | **0.000244140625** |
| with the fix | 1 |

That is twelve halvings for six frames, because the same object is handed to the button twice and each
render dims it once per use.

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

The fix builds the dimmed color rather than writing through to the caller's, so a disabled button sits at
half alpha and stays there instead of fading out. The JSX lives in `src/ui.tsx` because the scene
entrypoint has to be `src/index.ts`.
