# signature requests the auth site accepts and rejects

Harness scene for [auth#463](https://github.com/decentraland/auth/pull/463) —
_fix: only accept signature requests with canonical params_.

Fifteen buttons, one per param shape. Each click sends a real signature request through the explorer's
web3 API, which forwards it to the auth server and opens `decentraland.org/auth/requests/<id>` in the
browser. What that tab does — preview the payload and prompt the wallet, or show the signing-error view
— is the thing being reproduced.

Unlike the rest of this repo, this is not a self-measuring scene. It needs a live explorer, a wallet
login, and the deployed auth site, so the scene's job is to send exactly the right requests and record
what came back, not to decide the verdict on its own.

## What the PR changed

`recover()` on the auth site gained a params-shape guard that runs before anything reaches the wallet:

```ts
// src/shared/auth/signMethodGuard.ts
function assertSignatureParamsAreCanonical(method: string, params: unknown[] | undefined, signerAddress: string): void {
  ...
  if (normalizedMethod === 'personal_sign') {
    // Wallets sign the first param, so the message must come first and the signer second.
    if (typeof first !== 'string' || typeof second !== 'string' || isSigner(first, signer) || !isSigner(second, signer)) {
      throw new MalformedSignatureRequestError(method)
    }
    return
  }

  if (!isSigner(first, signer) || !hasPrimaryType(parseTypedData(second))) {
    throw new MalformedSignatureRequestError(method)
  }
}
```

It also drops `eth_signTypedData` (v1) from the allowlist.

The reason a shape guard is needed at all is that the request page and the wallet both read the params
**by position**, and before this PR they were free to disagree. `[harmlessTypedData, permitTypedData]`
is the case that makes it concrete: `extractSignaturePayload` previews the first typed-data param it
finds, which is the harmless one, while the wallet is handed param 1, which is the approval. The user
reads one payload and signs another.

## What the scene sends

The scene controls both `method` and `params` end to end. `EthereumApiWrapper.SendAsync` in the explorer
passes them to `DappWeb3EthereumApi.SendWithConfirmationAsync`, which puts them on the auth-server
request verbatim:

```csharp
SignatureIdResponse authenticationResponse = await RequestEthMethodWithSignatureAsync(new AuthorizedEthApiRequest
{
    method = request.method,
    @params = request.@params,
    authChain = identityCache.Identity!.AuthChain.ToArray(),
}, ct);
```

so whatever `src/cases.ts` builds is exactly what `assertSignatureParamsAreCanonical` is handed.

| Button | Params | With #463 | Before #463 |
| --- | --- | --- | --- |
| `personal_sign [message, signer]` | canonical | **accepted** | accepted |
| `personal_sign [signer, message]` | reversed | **rejected** | forwarded — the wallet signs the address |
| `personal_sign [message]` | one param | **rejected** | forwarded |
| `personal_sign [message, signer, x]` | three params | **rejected** | forwarded |
| `personal_sign [signer, signer]` | no message | **rejected** | forwarded |
| `personal_sign [message, other]` | not the signer | **rejected** | forwarded |
| `personal_sign [{ text }, signer]` | non-string message | **rejected** | forwarded |
| `v4 [signer, typed data]` | canonical, JSON string | **accepted** | accepted |
| `v4 [signer, typed data object]` | canonical, parsed | **accepted** | accepted |
| `v4 [decoy, permit]` | two payloads | **rejected** | forwarded — previews one, signs the other |
| `v4 [typed data, signer]` | v1 order | **rejected** | forwarded |
| `v4 [signer, "{not json"]` | unparseable | **rejected** | forwarded |
| `v4 [signer, v1 field list]` | no `primaryType` | **rejected** | forwarded |
| `v4 [other, typed data]` | not the signer | **rejected** | forwarded |
| `eth_signTypedData (v1)` | v1 method | **off the allowlist** | on the allowlist |

Both columns are verified rather than reasoned: `src/cases.ts` was run against
`assertSignatureParamsAreCanonical` and `assertMethodIsAllowed` at `5dc8441` (the merge of #463, 44
assertions) and against `assertMethodIsAllowed` plus `assertRequestIsNotImpersonatingSignIn` at its
parent `2a4493e`, where no params guard exists at all (31 assertions). Both runs pass.

The last row is the one the scene cannot actually push to the auth site. `eth_signTypedData` is not on
the explorer's own web3 whitelist, so it is refused locally and no browser tab opens:

```yaml
# unity-explorer, DynamicSceneLoaderSettings.asset
<Web3WhitelistMethods>k__BackingField:
  - eth_sendTransaction
  - eth_getBalance
  - personal_sign
  - eth_signTypedData_v4
  ...
```

That same whitelist is why there is no `eth_signTypedData_v3` button: the auth site allows v3, but a
scene cannot reach it. The button is kept because the local refusal is itself worth seeing — it comes
back in milliseconds instead of minutes, which is how the readout tells the two kinds of "no signature"
apart.

## Run it

```bash
npm install
npm start
```

Then, in the explorer:

1. **Log in with a wallet.** Email/OTP login signs in-process through `ThirdWebEthereumApi` and never
   opens the auth site, so none of this applies to it.
2. Load the scene and grant the Web3 API permission it asks for (`USE_WEB3_API` in `scene.json`).
3. Click a button. A browser tab opens at `decentraland.org/auth/requests/<id>`.

What to look for in that tab:

- **accepted** — the payload preview, then the wallet prompt. Sign it and the scene's row turns green
  with the signature's round-trip time.
- **rejected** — the signing error view, no wallet prompt, no retry offered.

## Reading the scene's own readout

Each row shows what came back. Green means the outcome matched what #463 says should happen, red means
it did not, amber means the request is still in flight.

Two things are worth knowing before watching the rows rather than the tab:

**A rejected request does not report back.** The recover-time rejection sets the error view and returns;
it never calls `sendFailedOutcome`. So the auth server holds the request until it expires
(`REQUEST_EXPIRATION_IN_SECONDS=300`) and only then does the explorer give up. A rejected row sits amber
for five minutes before it settles. The tab tells you the answer immediately — the row is just the
record.

**The explorer swallows the reason.** `EthereumApiWrapper` catches every failure and returns
`result: null` rather than an rpc error, so from inside the scene a blocked request, a denied one and an
expired one are indistinguishable. All the scene can say is "no signature", plus how long it took:
under a second means the explorer refused it locally, minutes mean the auth site was reached.

**One request at a time.** `DappWeb3EthereumApi` holds a mutex across the whole confirmation, so a
second click while one is in flight is ignored; the panel says which case is holding the slot. `reset
readout` clears the rows but cannot cancel an in-flight request.

## Finding the connected address

Every case needs the connected address, and getting it is the one part of this scene that does not
work the way the typings say. `~system/EthereumController.getUserAccount` is declared as returning
`{ address?: string }`, but unity-explorer's module hands back a bare string:

```js
// Explorer/Assets/StreamingAssets/Js/Modules/EthereumController.js
module.exports.getUserAccount = async function (message) {
    return UnityEthereumApi.UserAddress()   // C#: web3IdentityCache.Identity?.Address.ToString() ?? null
}
```

so `const { address } = await getUserAccount({})` is `undefined` there — silently, since `undefined`
is a legal value for an optional field. `~system/UserIdentity.getUserData` is the shape-faithful one
on that host (it JSON-parses a real `{ data: { publicKey, userId, hasConnectedWeb3 } }`), so
`src/signer.ts` asks all three sources in turn and normalizes whatever comes back — a string, an
`{ address }`, or a `{ data: { publicKey } }`.

It also matters that this failure be loud. Every click updates the panel's action line, refusals
included, so a button that does nothing still says why: no wallet connected, another case holding the
web3 slot, or the signer lookup having failed and what each source returned.

## Layout

```
src/cases.ts   the fifteen shapes, and what each is expected to do
src/signer.ts  finds the connected address across the three disagreeing host APIs
src/ui.tsx     the centered button panel and the per-case readout
src/index.ts   sends the request, records the outcome, rolls it up on the in-world sign
```

`src/cases.ts` deliberately imports nothing, so it can be dropped into the auth repo next to
`signMethodGuard.ts` and run against the guard directly, which is how the table above was checked.

## Notes

The scene pins `@dcl/sdk@7.26.0` like the rest of the repo, but nothing here depends on the SDK version:
`createEthereumProvider()` only forwards `{ method, params }` to `~system/EthereumController`. The
version that matters is the auth site's, and that is whatever `decentraland.org/auth` is currently
serving.

Buttons for the accepted cases sign a harmless `Statement` payload, so approving one costs nothing. The
`v4 [decoy, permit]` case is the only one carrying an approval, and it is a rejected case — if it ever
reaches a wallet prompt, that is the regression this scene exists to catch.
