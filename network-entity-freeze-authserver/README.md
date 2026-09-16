# a peer pinning a component with the maximum timestamp

Auth-server variant of [`network-entity-freeze`](../network-entity-freeze). **There is no PR for this
one** — it is the open issue with nothing in flight, and the scene exists to make the decision it needs
concrete.

## Why a separate scene

The original injects `PUT_COMPONENT_NETWORK` into a private engine. On the `auth-server` branch the
engine skips network messages rather than reading them, so that injection does nothing at all:

```
PUT_COMPONENT_NETWORK -> mappings created: 0
```

A peer here cannot reach another client's engine. It sends to the **server**, whose state every client
is then served and corrected against — which makes this worse on this branch, not better.

## The bug

LWW resolves by comparing a timestamp the *sender* chooses. Honest clients call `incrementTimestamp`,
which adds one from zero, and the wire field is a `uint32`. A peer that names `4294967295` therefore
wins every later comparison on that `(entity, component)` pair, permanently.

`validateMessagePermissions` accepts any timestamp whose dry run reports `StateUpdatedTimestamp`, and
a maximum one does. So the server takes it, relays it to the room, and from then on refuses the real
owner's updates as outdated — sending the owner a correction each time, telling it the attacker's
value is authoritative.

There is a second half. Any client that accepted the maximum has its own counter at the ceiling, so
its next `incrementTimestamp` returns `MAX_U32 + 1`, which `setUint32` cannot hold and silently wraps
to `0`. Everything it sends afterwards carries the lowest possible timestamp and loses to everyone.

## What the scene does

`src/index.ts` gives a private `Engine()` a `createServerValidator`, feeding its output back through a
transport the way the sync layer does.

1. `0xOWNER` creates the entity at `x=1`.
2. `0xATTACKER` writes `x=999` with timestamp `4294967295`.
3. `0xOWNER` sends four genuine updates with ordinary timestamps.

It reports the authoritative value at each step, whether the attack was relayed, how many of the
owner's updates got through, and how many corrections the owner was sent.

## Run it

```bash
npm install
npm start
```

Walk to the sign at `8,2,8`. Red if the authoritative value is stuck at `999` while the owner's own
updates are refused.

## Measured results

Headless, against the pinned `auth-server` build:

| step | authoritative value | relayed | corrections to owner |
| --- | --- | --- | --- |
| owner creates it | 1 | — | — |
| attacker writes `MAX_U32` | **999** | yes | — |
| owner sends 4 genuine updates | **999** | **0 of 4** | **4** |

The last row is the point. The owner cannot move its own entity, and the server answers every attempt
by correcting it back to the attacker's value.

## What a fix needs

Not an identity check — the attacker is not impersonating anyone, it is writing to a shared entity,
which `syncEntity` exists to allow. It needs a bound on the timestamp, and one detail decides the
shape: **rejecting large jumps does not protect a joining client**, because `updateFromCrdt` accepts
unconditionally when there is no current value, and every entity in a join snapshot is first contact.

`validateMessagePermissions` is the single place peer state enters the authoritative engine, so
bounding there keeps the poison out of every snapshot. The open question is reject versus clamp:
rejecting is simpler but breaks a peer that made many local changes while disconnected and comes back
legitimately ahead; clamping to `current + 1` keeps that peer working, stops anyone seizing the
ceiling, and makes the server the sequencer — which is what an authoritative architecture wants
anyway, but it is a semantic change to LWW rather than a bug fix.

This branch already has `__forceUpdateFromCrdt`, which applies state regardless of timestamp, so the
primitive to repair a frozen component exists; nothing detects one.

## Notes

This pins a CI build of the `auth-server` branch rather than a published release, because
`@dcl/sdk/network/server` does not exist on `main` and no release carries it yet.
