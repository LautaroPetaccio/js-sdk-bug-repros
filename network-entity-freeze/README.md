# freezing a synced component with the maximum timestamp

Reproduction scene for an **open issue with no fix PR yet**. It is related to, but not fixed by,
[js-sdk-toolchain#1608](https://github.com/decentraland/js-sdk-toolchain/pull/1608): #1608 gates entity
*creation*, while this is an attack on an entity that already exists, which #1608 deliberately leaves
open.

A synced entity is shared: any peer may write its components — that is what `syncEntity` is for. CRDT
conflicts are resolved Last-Writer-Wins by a **timestamp the sender chooses**. Honest clients increment
it by one from zero; the field is a `uint32`. A peer that writes the maximum value, `4294967295`, wins
every future comparison on that `(entity, component)` **permanently**.

## The bug

Two things follow from one maximum-timestamp write, and they land on different clients:

- **Freeze (every other client).** A receiver that has taken the maximum timestamp rejects every later,
  lower-timestamped write, so the component is pinned at the attacker's value forever:

  ```ts
  if (currentTimestamp > timestamp) {
    return ProcessMessageResultType.StateOutdatedTimestamp   // the owner's real update, dropped
  }
  ```

- **Overflow (the owner).** The owner received the write too, so its own counter for that component is
  now at the maximum. Its next `incrementTimestamp` returns `MAX_U32 + 1`, which `setUint32` cannot hold
  and silently wraps to `0`, so everything the owner sends from then on carries the lowest possible
  timestamp and loses to everyone.

The owner's **own screen looks fine** — a local write always wins locally — which is what makes this
invisible to the person being frozen.

## Who hits it

Any multiplayer scene, on any shared entity, from a modified client (the honest SDK only ever increments
by one). One message is enough, and it is not recoverable within the session: the owner cannot out-bid
the maximum, and its wrapped counter keeps it at the bottom.

## What the scene does

`src/index.ts` runs two private engines — the entity's **owner** and another **observer** peer — and
relays the owner's outgoing messages into the observer, so what the rest of the room sees is measured,
not assumed.

1. The owner creates and syncs an entity at `x=1`; the observer receives it.
2. The attacker writes `x=999` with timestamp `4294967295`, delivered to both.
3. The owner drives its own Transform to `x=42` four times.

It then reports the owner's local value, the observer's value, and the timestamps the owner emitted.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the observer is frozen at `999` while the owner sees `42` and the
owner's emitted timestamps include `0`.

## Measured results

Headless, against `@dcl/sdk@7.26.0`, and unchanged against #1608's `dist`:

| | owner's own screen | every other client | owner's emitted timestamps |
| --- | --- | --- | --- |
| `@dcl/sdk@7.26.0` | 42 | **999 (frozen)** | **0, 1, 2, 3 (overflowed)** |
| with #1608 | 42 | 999 (frozen) | 0, 1, 2, 3 |

The rows are identical: #1608 gates creation, not writes to an existing entity, so it does not touch
this. The observer diverging from the owner is the whole symptom — one player sees their object moving,
everyone else sees it stuck.

## What a fix would need

Two independent pieces, neither in any current PR:

- **The overflow (#8)** is a plain bug regardless of attackers: `incrementTimestamp` can return a value
  `setUint32` cannot represent, and wraps it. Worth fixing on its own terms.
- **The freeze (#7)** needs a bound on the timestamp *jump* — reject an incoming timestamp far ahead of
  the value currently held — rather than an identity check, because the writer is legitimately allowed
  to write. The unconditional-accept branch is `currentTimestamp === undefined`, so first contact and
  state transfer stay unaffected; only the contested case is bounded.

## Notes

The scene builds messages with the same writer the SDK uses over comms
(`PutNetworkComponentOperation`), so the timestamp on the wire is the real one. Because there is no fix
PR, the verdict is `ISSUE PRESENT` rather than a red/green flip; point the scene at a build that bounds
the timestamp jump and the observer will track the owner again.
