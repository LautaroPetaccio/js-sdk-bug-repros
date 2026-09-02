import { getUserAccount } from '~system/EthereumController'
import { getUserData, getUserPublicKey } from '~system/UserIdentity'

/**
 * Finding the connected address is fiddlier than the typings suggest.
 *
 * `~system/EthereumController.getUserAccount` is declared as `{ address?: string }`, but
 * unity-explorer's module returns `UnityEthereumApi.UserAddress()`, which is a bare string:
 *
 *   module.exports.getUserAccount = async function (message) {
 *     return UnityEthereumApi.UserAddress()
 *   }
 *
 * so destructuring `.address` off it yields `undefined` on the one host this scene targets.
 * `getUserData` is the shape-faithful one there — it JSON-parses a real response — so all three
 * sources are tried and whatever they hand back is normalized here.
 */

/** Digs an `0x…` address out of a string, a `{ address }`, or a `{ data: { publicKey } }`. */
function readAddress(response: unknown): string {
  if (typeof response === 'string') return response
  if (typeof response !== 'object' || response === null) return ''

  const record = response as Record<string, unknown>
  for (const key of ['address', 'publicKey', 'userId']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  if (typeof record.data === 'object' && record.data !== null) return readAddress(record.data)
  return ''
}

function isAddress(value: string): boolean {
  return value.length === 42 && value.substring(0, 2).toLowerCase() === '0x'
}

export type SignerLookup = { signer: string; source: string; tried: string[] }

/**
 * Asks every source in turn and keeps the first real address. The sources that fail are reported
 * too: with no wallet connected they all come back empty, and that is worth telling apart from a
 * source that threw.
 */
export async function resolveSigner(): Promise<SignerLookup> {
  const sources: [string, () => Promise<unknown>][] = [
    ['getUserData', () => getUserData({})],
    ['getUserAccount', () => getUserAccount({})],
    ['getUserPublicKey', () => getUserPublicKey({})]
  ]

  const tried: string[] = []
  for (const [name, call] of sources) {
    try {
      const address = readAddress(await call())
      if (isAddress(address)) return { signer: address, source: name, tried }
      tried.push(`${name}: ${address === '' ? 'empty' : `not an address (${address})`}`)
    } catch (e) {
      tried.push(`${name}: threw ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { signer: '', source: '', tried }
}
