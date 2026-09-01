# aliased scene observables firing twice

Reproduction scene for [js-sdk-toolchain#1580](https://github.com/decentraland/js-sdk-toolchain/pull/1580) —
_fix(sdk): notify aliased scene observables once per event_.

`onEnterSceneObservable` and `onPlayerConnectedObservable` are two names for the same event. Subscribe to
both and every observer on **both** runs twice for a single player. Same for
`onLeaveSceneObservable` and `onPlayerDisconnectedObservable`.

## The bug

`packages/@dcl/sdk/src/observables.ts` decides whether to install the underlying listener by looking at
the **event name**:

```ts
function subscribe(eventName: keyof IEvents) {
  if (subscriptions.has(eventName)) return
  switch (eventName) {
    case 'onEnterScene':
    case 'playerConnected': {
      subscribeEnterScene()
      break
    }
```

Two names share one `subscribeEnterScene`, so subscribing to both installs a second
`players.onEnterScene` listener. Each copy notifies both observables, because that is exactly how the
aliasing is meant to work:

```ts
function subscribeEnterScene() {
  players.onEnterScene((player) => {
    if (subscriptions.has('onEnterScene')) onEnterSceneObservable.notifyObservers(...)
    if (subscriptions.has('playerConnected')) onPlayerConnectedObservable.notifyObservers(...)
  })
}
```

Two listeners, each notifying two observables, one player: four notifications where two were wanted.

## Who hits it

Any scene that listens to both names, which is easy to do by accident since the two are documented
separately and one is the deprecated ECS6 spelling of the other. Subscribing to only one name behaves
correctly, so this appears the moment a second listener is added somewhere else in the scene, possibly in
a library.

Doubling a join is not harmless: it is usually paired with a spawn, a greeting, a counter, or a network
message.

## What the scene does

A player is, as far as the SDK is concerned, an entity carrying `PlayerIdentityData` and `AvatarBase`.
`src/index.ts` adds an observer to each of the two enter-scene observables, waits, then creates such an
entity, which is what a real join looks like from inside a scene. After the players helper has had a
frame to notice it, the scene reports how many times each observable was notified for that one join.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red when one join produces more than one notification per observable, green
when it produces exactly one.

## Measured results

Headless, one synthesised join with both observables subscribed, against `@dcl/sdk@7.26.0` and then
against the same artifact with #1580 applied to `@dcl/sdk/observables.js`:

| | `onEnterSceneObservable` notified | `onPlayerConnectedObservable` notified |
| --- | --- | --- |
| `@dcl/sdk@7.26.0` | **2** | **2** |
| with the fix | 1 | 1 |

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

This is next door to [`observable-subscription-fallthrough`](../observable-subscription-fallthrough),
which covers #1467 in the same file. That one was the missing `break` statements inside the switch; this
one is the gate in front of it. Both had to be wrong for the released behaviour, and fixing the first did
not fix the second.
