# `@dcl/sdk/players` tracking — on the fix

[js-sdk-toolchain#1512](https://github.com/decentraland/js-sdk-toolchain/pull/1512)

The same 25-row matrix as [`players-helper-tracking`](../players-helper-tracking), pinned to the
**published build of the PR branch** instead of the last release that carries the bugs. Nothing to
overlay, no toolchain clone to build: `npm install && npm run verify`.

```
FIXED: all 25 checks pass
pass=25 fail=0 n/a=0 total=25
```

Against the released `@dcl/sdk@7.26.0`, the sibling scene reports:

```
BUG REPRODUCED: 11 of 25 checks fail, 8 not applicable
pass=6 fail=11 n/a=8 total=25
```

Same checks, same harness, same source file — the only difference between the two folders is one
line of `package.json`. That is the point of having both: the matrix is not asserting against a
snapshot of expected output, it is measuring behaviour that genuinely changes.

## Which build this is

```
@dcl/sdk 7.26.1-32893350833.commit-c0528a4
```

A CI artifact from the `feat/server-session` branch, served off the SDK team CDN rather than the
npm registry — which is why it is a URL dependency and not a version range:

```
https://sdk-team-cdn.decentraland.org/@dcl/js-sdk-toolchain/branch/feat/server-session/dcl-sdk-7.26.1-32893350833.commit-c0528a4.tgz
```

`commit-c0528a4` is CI's merge of the branch into `auth-server`, not a commit on the branch
itself, so it will not appear in `npm view @dcl/sdk versions`. The URL is pinned to that exact
tarball on purpose: a branch-tip URL would silently change what this scene measures.

**This pin goes stale.** When #1512 merges and a release carries it, replace the URL with the
published version — or delete this folder and fold the note into the sibling's README, since
"point it at a fixed SDK" stops needing a demonstration once the fix is in a release.

## Two consequences of using an `auth-server` build

- `sdk-commands` from this branch writes `authoritativeMultiplayer: true` into `scene.json` and a
  `server-logs` script into `package.json` on first build. Both are committed here already, so
  `npm run build` leaves the tree clean instead of dirtying it.
- The scene itself does not use the authoritative server — every check drives its own isolated
  `Engine()`. The flag is inert here; it is committed only so the build is idempotent.

## Keeping the two folders honest

`src/checks.ts` is duplicated verbatim rather than imported across folders, because this repo's
contract is that each directory is a complete, standalone scene. Duplication that silently drifts
would be worse than either, so:

```
npm run check-sync
```

diffs this copy against the sibling's and fails if they have diverged. Run it after touching
either.

## Running it

```
npm install
npm start            # in-world readout on a TextShape, and on the console
npm run verify       # the same matrix, headless, with the rejection hook installed
npm run check-sync   # assert checks.ts still matches the sibling scene
```

Expect a stack trace in the `verify` output. That is `runIsolated` logging the handler this scene
throws on purpose — the isolation working, not a failure.

For what each row exercises and why two of them read `N-A` in-world, see the
[sibling scene's README](../players-helper-tracking/README.md).
