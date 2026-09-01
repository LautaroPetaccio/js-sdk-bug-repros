# unset OneOf field crashing every engine update

Reproduction scene for [js-sdk-toolchain#1570](https://github.com/decentraland/js-sdk-toolchain/pull/1570) —
_fix(ecs): make an unselected OneOf case serializable_.

`Schemas.OneOf().create()` returns `{}`, so a component with a `OneOf` field the scene never set has no
`$case`. Serializing it throws, and the throw comes out of `engine.update()`, so the tick that was
writing the component dies — and so does every tick after it, because the component is still there.

## The bug

`packages/@dcl/ecs/src/schemas/OneOf.ts`:

```ts
serialize({ $case, value }: DeepReadonly<OneOfType<T>>, builder: ByteBuffer): void {
  const _value = keyToIndex[$case.toString()] + 1
  ...
},
create() {
  return {} as OneOfType<T>
},
```

`create()` hands out a value that `serialize()` cannot write. The two disagree, and nothing in between
notices, because `Schemas.Map.create()` fills the field in for you.

## Who hits it

Creating the component is the whole reproduction:

```ts
const Choice = engine.defineComponent('choice', {
  pick: Schemas.OneOf({ velocity: Schemas.Int, label: Schemas.String })
})

Choice.create(engine.addEntity())   // the next update throws
```

`Schemas.OneOf` is public API, and `buildSchema` also builds one for any composite carrying a `one-of`
field, so a composite can bring the same crash in without a line of schema code being written by hand.
The error surfaces as `TypeError: Cannot read properties of undefined (reading 'toString')` from
somewhere inside the engine, with nothing pointing at the field that caused it.

## What the scene does

`src/index.ts` counts down, then creates that component on a private `Engine()` and runs one update,
reporting whether the update resolved or rejected. A private engine is what makes the result readable:
put the same component on the scene's own engine and the throw takes out the scene update, so there is
no frame left in which to draw the verdict.

On a fixed SDK the scene keeps running updates afterwards and counts them, so the readout shows the
engine is healthy rather than merely quiet.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. White while it counts down, then red with the thrown message when the bug
reproduces, green with a rising counter when it does not.

## Measured results

Headless, creating the component and awaiting one update, against `@dcl/sdk@7.26.0` and then against
the same artifact with #1570's encoding applied to `@dcl/ecs/dist/schemas/OneOf.js`:

| | `engine.update()` | message |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **rejects** | `Cannot read properties of undefined (reading 'toString')` |
| with the fix | resolves | — |

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

The fix keeps `{}` as the unset value rather than defaulting to the first declared case. That matters
for scenes: an invented default would be a real value the scene never chose, it would be written to the
wire, and composite instancing would remap it if the case happened to hold an entity.
