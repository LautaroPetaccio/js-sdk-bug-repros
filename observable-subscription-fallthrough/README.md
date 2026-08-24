# One enter-scene event, two notifications

A reproduction of an `@dcl/sdk` bug: the `switch` that wires up the deprecated event observables has
no `break` in any of its cases, so subscribing to one event silently subscribes the SDK to all the
later ones — and then subscribes to some of them a second time when the scene asks for them for
real. Every enter-scene, leave-scene, realm-change, expression and profile-change handler after that
runs twice per event.

Fixed by [js-sdk-toolchain#1467](https://github.com/decentraland/js-sdk-toolchain/pull/1467).
Reproduced against `@dcl/sdk@7.26.0`.

This is a complete scene, and one avatar is enough: your own player entity gets `PlayerIdentityData`
and `AvatarBase` when the scene loads, which is exactly what fires `onEnterSceneObservable`. No
second player, no remote avatar, nothing to click.

## The bug

`packages/@dcl/sdk/src/observables.ts` — `processObservables()`:

```ts
function subscribe(eventName: keyof IEvents) {
  if (subscriptions.has(eventName)) return
  switch (eventName) {
    case 'playerClicked': {
      subscribePlayerClick()
      // <- no break
    }
    case 'onEnterScene':
    case 'playerConnected': {
      subscribeEnterScene()
      // <- no break
    }
    case 'onLeaveScene':
    case 'playerDisconnected': {
      subscribeLeaveScene()
      // <- no break
    }
    case 'onRealmChanged': {
      subscribeRealmChange()
      // <- no break
    }
    case 'playerExpression': {
      subscribePlayerExpression()
      // <- no break
    }
    case 'profileChanged': {
      subscribeProfileChange()
      // <- no break
    }
  }
  subscriptions.add(eventName)
}
```

Two things go wrong.

**Unrelated listeners get installed.** Adding an observer to `onPlayerClickedObservable` matches the
first case and then falls through all five that follow, so the SDK also registers the enter-scene and
leave-scene player callbacks and `onChange` listeners on `RealmInfo`, `AvatarEmoteCommand`,
`AvatarBase` and `AvatarEquippedData` — for events the scene never asked about.

**Those subscriptions are then duplicated.** `subscriptions.add(eventName)` records only the event
that was *requested*. So after subscribing to `playerClicked`, the set holds `'playerClicked'` alone,
even though `subscribeEnterScene()` has already run. A later
`onEnterSceneObservable.add(...)` sees that `'onEnterScene'` is not in the set and runs
`subscribeEnterScene()` again — and `players.onEnterScene(cb)` pushes onto a callback list, so the
SDK now holds two callbacks that both call `onEnterSceneObservable.notifyObservers(...)`. One real
enter-scene event, two notifications. The same doubling applies to leave/disconnect, realm change,
expression and profile change.

The fix is a `break` in every case.

## Steps

Requires Node >= 20.

```bash
npm install
npm start
```

That serves the scene on `http://localhost:8000` and deep-links into your installed Explorer. Walk
in: a sign in the middle of the parcel is the readout. The scene also `console.log`s the same text,
but explorers do not surface scene logs reliably, so read the sign.

### What you see when broken

Red text:

```
observable subscription fall-through
unrelated listeners installed by the playerClicked subscription: 4 (expected 0)
onEnterScene notifications for 0x...: 2 (expected 1)
BUG REPRODUCED: one enter-scene event notified the observable twice
```

### What you see when fixed

Green text:

```
observable subscription fall-through
unrelated listeners installed by the playerClicked subscription: 0 (expected 0)
onEnterScene notifications for 0x...: 1 (expected 1)
FIXED: one enter-scene event, one notification
```

If other players are in the parcel with you, each one gets its own line. Every line should read `1`.

## How to read the two numbers

`src/index.ts` does three things, in this order:

1. Wraps `onChange` on `RealmInfo`, `AvatarBase`, `AvatarEquippedData` and `AvatarEmoteCommand` — the
   components that only the realm, profile and expression observables need — with a counter that
   calls through. Nothing else in the scene touches them.
2. Adds an observer to `onPlayerClickedObservable`, then snapshots the counter. Every listener it
   counts is one the SDK installed for an event the scene did not subscribe to: `4` is the
   fall-through, `0` is the fix. The snapshot is taken immediately, because the SDK's own player
   helper legitimately registers `AvatarBase.onChange` per player entity on later ticks.
3. Adds an observer to `onEnterSceneObservable` that counts notifications per user id. This is the
   subscription the bug duplicates, and the count is the payload: one enter-scene event per player,
   so anything above `1` is a duplicate registration.

## Verifying a fix

The scene has no assertions of its own to change — point it at a fixed SDK and the sign turns green.

Once [#1467](https://github.com/decentraland/js-sdk-toolchain/pull/1467) is on `main`:

```bash
npm run upgrade-sdk:next   # @dcl/sdk@next tracks main
npm start
```

Before it merges, use the PR's CI build (published as `7.x.y-<run>.commit-<sha>` — list them with
`npm view @dcl/sdk versions`):

```bash
npm install --save-dev @dcl/sdk@<version-from-the-pr-build>
```

Or link a local build. With a [js-sdk-toolchain](https://github.com/decentraland/js-sdk-toolchain)
checkout beside this one, on the fix branch:

```bash
cd ../js-sdk-toolchain/packages/@dcl/sdk && npm run build   # compiles in place
cd -
npm install --no-save file:../js-sdk-toolchain/packages/@dcl/sdk
npm start
```

`npm install` restores the published SDK.

## Observed

Both readouts above are the scene's actual output, taken by running the built bundle in the QuickJS
scene runtime with a scripted renderer that reports one local player (entity 1) with
`PlayerIdentityData` and `AvatarBase`:

| SDK | unrelated listeners | onEnterScene notifications |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` (published) | 4 | 2 |
| local build, unpatched | 4 | 2 |
| local build with the `break`s | 0 | 1 |
