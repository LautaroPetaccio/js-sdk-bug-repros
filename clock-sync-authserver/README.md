# built-in server clock: sync, freeze and latency

Checks the server clock that
[js-sdk-toolchain#1628](https://github.com/decentraland/js-sdk-toolchain/pull/1628) adds to
`@dcl/sdk/network` on the `auth-server` branch: `getServerTime()`, `getClockSyncStats()`,
`freezeServerClock()` and the server-side `getPlayerLatency()`.

## What is checked

The PR is a feature, so there is no "before" without it. The scene instead checks the behaviour the
API promises, across the three builds the PR went through: as opened, after the first review, and
the head. Each failing check on an earlier build is a bug a later commit fixed.

| Area | What is checked |
| --- | --- |
| accuracy | syncs within 5 s of joining; no systematic bias against the server's own clock |
| motion | the server time never runs backwards and never stands still |
| freeze | holds when called every frame; holds when requested before the first reply; releases by slewing, including after a stretch with no reads |
| robustness | syncs over a link slower than the ping interval; forgets the estimate on disconnect and resyncs on reconnect; corrects a delayed first reply within 3 s |
| clock steps | a 3 s step of the client's clock, back or forward, on a runtime without `performance.now()` (the scene runtime may lack it) is recovered within 5 s and 8 s, without stalling or reversing |
| latency | `getPlayerLatency` on the server reads the round trip plus at most the two tick waits |
| registry | `registerMessages` rejects the reserved `__sdkClockPing` name |

## Running it

```bash
npm install
npm run verify   # headless: 18 checks against a simulated network, exit code 1 when any fails
npm start        # in-world: preview with the authoritative server; open two windows side by side
```

`npm run verify` needs no explorer and no comms. It bundles the real `@dcl/sdk/network` module and
evaluates it twice, in two `vm` contexts, as the authoritative server and as a client. Each has its own
`Date.now()` (the client's is 4.3 s off), and `performance.now()` where a check wants one. The
`~system` calls go to a host that plays the explorer:

- `sendBinary` hands over outgoing messages and returns the ones that have arrived;
- a client's messages go only to the server, as both explorers route them in an authoritative scene;
- the server ticks every 30 ms and the client every 16 ms;
- each network leg takes 40-60 ms, delivered in order, and is seen only at the receiver's next tick.

Each check drives the public API only, so the same runner works against every build.

In-world, the sign shows the server clock as a seconds counter, the round trip, the sample count and
the offset to `Date.now()`. Ten seconds after syncing, the client freezes the clock for ten seconds by
calling `freezeServerClock` every frame, then releases it. It checks throughout that the clock never
stalls, runs backwards or jumps, and prints a verdict. The server logs each player's latency every two
seconds (`npm run server-logs`). Localhost latency is too low and too steady to reach most of the
cases above, so treat the in-world run as a live view and `npm run verify` as the verdict.

The scene pins the CI build of the PR head. To see the other columns, switch builds:

```bash
npm run use:opened   # the PR as opened (ceaffef3)
npm run use:review   # after the first review (49d14fcf)
npm run use:pr       # back to the head
```

## Measured

`npm run verify` on each build. Numbers are from the simulation, so they are exact and repeat run to run.

| Build | Verdict |
| --- | --- |
| `7.29.1-35116602724.commit-daaba71` (PR as opened, `ceaffef3`) | `BUG REPRODUCED: 11 of 18 checks fail` |
| `7.30.2-39266114663.commit-62a7ddb` (after the first review, `49d14fcf`) | `BUG REPRODUCED: 5 of 18 checks fail` |
| `7.30.2-39279662859.commit-c3a4e79` (PR head, `5907e2c1`) | `FIXED: all 18 checks pass` |

| Check | As opened | First review | Head |
| --- | --- | --- | --- |
| syncs within 5 s of joining | 336 ms | 304 ms | 304 ms |
| mean error with a 100 ms server tick, worst of 3 seeds (limit 20 ms) | **-31.9 ms** | 13.5 ms | 9.1 ms |
| never runs backwards / never stands still | yes | yes | yes |
| `getPlayerLatency` on a 100 ms link (limit 90-170 ms) | **180 ms** | 134 ms | 134 ms |
| `freezeServerClock(true)` every frame | **moves 56 ms** | holds | holds |
| freeze requested before the first reply | **dropped, moves 60 ms** | holds | holds |
| unfreezing, largest frame-to-frame change (limit 2 ms) | **4.0 ms** | 0.8 ms | 0.8 ms |
| unfreezing after 20 s without reads | **jumps 44 ms** | **jumps 52 ms** | 0.8 ms |
| 1.6 s round trip | **never syncs** | 3.3 s | 3.3 s |
| `registerMessages({ __sdkClockPing })` | **accepted** | throws | throws |
| disconnecting | **keeps the old estimate** | forgets it | forgets it |
| first reply delayed 1.2 s (error 597 ms), time to within 20 ms | 0.3 s | **11.8 s** | 0.3 s |
| 3 s local clock step back, time to within 20 ms | **17.2 s** | **17.1 s** | 3.6 s |
| 3 s local clock step forward, time to within 20 ms | 7.7 s | **16.7 s** | 6.1 s |
| ... meanwhile | **runs back 2988 ms** | **stands still 2992 ms** | keeps running |

What each failure was:

- **As opened.** The server stamped its pong once, a tick before it left, so every client read the
  server's clock about half a server tick late. Calling `freezeServerClock(true)` again re-captured
  the live estimate, so a scene freezing every frame never froze. A freeze asked for before the first
  reply was dropped. Only the reply to the latest ping was accepted, so a round trip longer than the
  1.5 s ping interval never synced. Nothing reserved the message names, and nothing reset the estimate
  on disconnect. With no monotonic guarantee, a clock step could run the clock backwards.
- **After the first review.** Corrections were slewed at 5% from the very first sample, so a delayed
  first reply stayed hundreds of ms off for seconds. Stale samples from before a clock step kept winning
  the window until they aged out. The slew only advanced when the clock was read, so an unfreeze after
  a quiet stretch applied the whole correction at once. A backward correction over 1 s stopped the
  clock behind the monotonic clamp.
- **Both.** The published `clock-sync.d.ts` referred to `createClockSync`, which `stripInternal`
  removes, so `npm run build` of any scene importing `@dcl/sdk/network` failed to typecheck. The head
  is the first build this scene compiles against.

What remains at the head, by design: `getServerTime()` is still off by up to half a tick on each side,
because neither end sees a message until its next tick; that is the +9 ms above. `getPlayerLatency`
reads about the round trip plus the two tick waits. Removing either needs the explorers to stamp
arrival ticks on incoming messages, which is a protocol change outside this PR.

The in-world scene builds only against the head (see the `.d.ts` failure above), and has not been run
in an explorer here.
