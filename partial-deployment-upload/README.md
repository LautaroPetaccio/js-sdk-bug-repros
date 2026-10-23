# does a scene over 50 MiB deploy in batches, with progress and cancel?

Test scene for batched scene deployments
([ADR-325](https://github.com/decentraland/adr/pull/325)) and for following and cancelling them
from Creator Hub ([creator-hub#1692](https://github.com/decentraland/creator-hub/pull/1692)).

`sdk-commands deploy` (SDK 7.31.0 and newer) uploads in batches when the scene's files add up to
50 MiB or more, and in a single request below that (even between 32 and 50 MiB, above one batch).
This scene is a sign plus a `payload/` folder of random files that gets it over that line. The
payload is never loaded.

## Setup

1. Put your world in `worldConfiguration.name` in `scene.json` (a NAME you own, e.g.
   `my-name.dcl.eth`).
2. Install and generate a payload:

   ```
   npm install
   npm run payload
   ```

`npm run payload` writes 64 MiB of random files to `payload/` (16 files of 4 MiB, gitignored). The
bytes are new on every run, so the server never has them already and every deploy uploads all of
them. **Run it again before every deploy**: re-deploying the same payload uploads almost nothing.
`PAYLOAD_MIB` and `PAYLOAD_FILE_MIB` change the size, for example `PAYLOAD_MIB=40 npm run payload`
for a scene under the threshold, which goes out in one plain request. Files over 50 MB are rejected
by the CLI, so keep `PAYLOAD_FILE_MIB` under 48.

## Testing it in Creator Hub

1. In Creator Hub, click **Import Scene**, pick this folder and open the scene.
2. Run `npm run payload` in the folder.
3. Publish it to your World. The deploy screen shows *"Uploading X of Y"* and *"Batch N of M
   uploaded"* (batches are 32 MiB, so the default payload takes about three).
4. To test cancelling, run `npm run payload` again, publish, and click **Cancel** while it uploads.

## Testing it from the CLI

```
npm run deploy
```

`predeploy` regenerates the payload, and the deploy targets the production worlds server. Sign within
5 minutes of the signing page opening. Each batch logs `Uploaded <n> MB of <total> MB (batch
<i>/<n>)`. The linker page shows the same progress and a **Cancel** button. A server without batched
uploads logs `The target server does not support batched uploads` and gets a single request.

## Limits that shape it

- A `.dcl.eth` world can take whatever its owner's wallet has left (`GET /wallet/<address>/stats`:
  `maxAllowedSpace - usedSpace`, which grows with the names and LAND held), capped at 500 MiB per
  scene. An ENS world is held to 36 MiB.
- Batches are 32 MiB (or the largest file, if bigger), with up to three uploading at once.
