# one failing test ending the whole in-scene run

Reproduction scene for [js-sdk-toolchain#1575](https://github.com/decentraland/js-sdk-toolchain/pull/1575) —
_fix(sdk): report failing in-scene tests instead of stranding the run_.

Two ways the in-scene test runner loses the **run** rather than the test: a failure that arrives from
inside a yielded function is never reported and escapes into `engine.update`, and a test that rejects
with something that is not an error stops every test after it from running.

## The bug

`packages/@dcl/sdk/src/testing/runtime.ts` calls a yielded function with no `try` around it, unlike the
promise branch immediately above it:

```ts
} else if (typeof value === 'function') {
  nextTickFuture.push(() => {
    scheduleValue(value(), env)     // a throw here never reaches env.reject
  })
```

and builds the failure report with `err.toString()`:

```ts
const reject = (err: any) => {
  if (resolved) throw new Error('resolved twice')
  resolved = true
  ...
  testingModule.logTestResult({ name: entry.name, ok: false, error: err.toString(), ... })
    .finally(scheduleNextRun)
```

`undefined.toString()` throws, and it throws *after* `resolved` is set, so there is no way back:
`logTestResult` never runs, its `.finally(scheduleNextRun)` never runs, and no later test is scheduled.

## Who hits it

Both shapes are ordinary test code. An assertion inside `yield () => { ... }` is the normal way to check
something on a specific frame. `throw undefined` is rarer on purpose, but `await Promise.reject()` is
not, and it lands in exactly the same place.

The failure mode is what makes this expensive: the console shows `🔴 Test failed` for one test and then
silence. Nothing says the remaining tests never ran, so a suite can quietly shrink to its first failure.

## What the scene does

`src/index.ts` builds two private engines, each with its own runner and a stub standing in for the host's
`~system/Testing` module, then records what the runner reported:

1. One test that yields a function which throws. Was it reported as a failure, and did the throw come out
   of `engine.update`?
2. One test that throws `undefined`, followed by a second, ordinary test. Did the second one run?

The stub is what makes this measurable in-world: the real module reports to the host, this one keeps the
results where the scene can read them.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when a failing test takes the run with it, green when both failures are
reported as failures and the run carries on.

## Measured results

Headless, driving the same two plans, against `@dcl/sdk@7.26.0` and then against the same artifact with
#1575's two changes applied to `@dcl/sdk/testing/runtime.js`:

| | yielded throw reported | escaped into `engine.update` | test after `throw undefined` ran |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | **no** | **yes** | **no** |
| with the fix | yes | no | yes |

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

This scene drives `createTestRuntime` directly rather than using `@dcl/sdk/testing`'s exported `test`,
which binds to the scene's own engine and reports to the host. Driving it directly is what lets the
scene both feed it failing tests and read back what it did with them.
