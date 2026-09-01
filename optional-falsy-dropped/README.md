# optional values that are falsy being dropped

Reproduction scene for [js-sdk-toolchain#1582](https://github.com/decentraland/js-sdk-toolchain/pull/1582) —
_fix(ecs): write optional values that are falsy_.

`Schemas.Optional` decides whether a value is present by testing the value itself, so `false`, `0` and
`''` are all treated as unset. They are never written, and they come back as `undefined`.

## The bug

`packages/@dcl/ecs/src/schemas/Optional.ts`:

```ts
serialize(value: DeepReadonly<T> | undefined, builder: ByteBuffer): void {
  if (value) {
    builder.writeInt8(1)
    spec.serialize(value, builder)
  } else {
    builder.writeInt8(0)
  }
}
```

`if (value)` is not the same question as "is there a value". An `Optional(Boolean)` can therefore hold
`true` or nothing at all, which is exactly the case the type exists for and the one it cannot express.

## Who hits it

Any component with an optional flag, count or label whose meaningful value happens to be falsy. It is
worst over the wire: the field is written as absent, so a peer or the renderer receives nothing for it
and keeps whatever it already had. Turning a flag off looks like not mentioning it.

`Schemas.Optional` is public, and `buildSchema` builds one for every optional field in a composite, so
composites carry the same behaviour without a line of schema code being written by hand.

## What the scene does

`src/index.ts` puts four values through the same serializer the engine uses for CRDT and reads each one
back: `false`, `0`, `''` and, as the control, `true`. The control is the point of the scene, since it
shows the type works perfectly for exactly one of its two boolean values.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when a value does not come back as itself, green when all four do.

## Measured results

Headless, the same four round trips, against `@dcl/sdk@7.26.0` and then against the same artifact with
#1582 applied to `@dcl/ecs/dist/schemas/Optional.js`:

| value | `@dcl/sdk@7.26.0` reads back | with the fix |
| --- | --- | --- |
| `false` | **undefined** | `false` |
| `0` | **undefined** | `0` |
| `''` | **undefined** | `''` |
| `true` | `true` | `true` |

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

Regenerating the toolchain's snapshot scenes after the fix changed no CRDT payload, only bundle sizes, so
nothing shipping today was relying on a falsy optional being dropped.

`ReadWriteByteBuffer` lives under `@dcl/ecs/dist/serialization/ByteBuffer` and is not re-exported from
`@dcl/sdk/ecs`, which is why `@dcl/ecs` is pinned alongside `@dcl/sdk` in `package.json`.
