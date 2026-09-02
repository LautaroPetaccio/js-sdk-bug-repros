/**
 * Every signature-request shape auth#463 has an opinion about, one entry per button.
 *
 * The scene owns `method` and `params` end to end: the explorer forwards both verbatim to the auth
 * server, and the auth site reads them back at recover time. So whatever is written here is exactly
 * what `assertSignatureParamsAreCanonical` is handed.
 */

/** What the auth site should do with a case. */
export type Expected =
  /** Reaches the wallet and comes back signed. */
  | 'accepted'
  /** MalformedSignatureRequestError at recover time: the signing-error view, no wallet prompt. */
  | 'rejected'
  /** Never leaves the explorer: the method is not on its own web3 whitelist. */
  | 'blocked-upstream'

export type SignatureCase = {
  id: string
  /** Button caption. Kept to the param shape, since that is the whole variable. */
  label: string
  method: string
  /** Built per click: the connected address is only known at runtime. */
  buildParams: (signer: string) => unknown[]
  expected: Expected
  note: string
}

/** An address that is not the connected one, for the cases that swap the signer out. */
const OTHER_ADDRESS = '0x0000000000000000000000000000000000000002'

const MESSAGE = 'canonical params check'

/** Hex-encodes ASCII the way the explorer hex-encodes what `signMessage` is given. */
function toHex(text: string): string {
  let out = '0x'
  for (let i = 0; i < text.length; i++) {
    const byte = text.charCodeAt(i).toString(16)
    out += byte.length === 1 ? '0' + byte : byte
  }
  return out
}

const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' }
]

/** A harmless message. In the two-payload case this is the one the request page previews. */
function statement() {
  return {
    domain: { name: 'Decentraland', version: '1' },
    primaryType: 'Statement',
    types: { EIP712Domain: DOMAIN_FIELDS, Statement: [{ name: 'text', type: 'string' }] },
    message: { text: MESSAGE }
  }
}

/** A token approval. In the two-payload case this is the one the wallet would be handed. */
function permit(owner: string) {
  return {
    domain: {
      name: 'Token',
      version: '1',
      chainId: 1,
      verifyingContract: '0x0000000000000000000000000000000000000001'
    },
    primaryType: 'Permit',
    types: {
      EIP712Domain: [
        ...DOMAIN_FIELDS,
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    },
    message: {
      owner,
      spender: '0x000000000000000000000000000000000000dead',
      value: '1000',
      nonce: '0',
      deadline: '9999999999'
    }
  }
}

/** The v1 field list: no primaryType, which is how the guard tells it apart from a v3/v4 payload. */
function fieldList() {
  return [{ type: 'string', name: 'Message', value: MESSAGE }]
}

export const CASES: SignatureCase[] = [
  {
    id: 'personal-sign-canonical',
    label: 'personal_sign [message, signer]',
    method: 'personal_sign',
    buildParams: signer => [toHex(MESSAGE), signer],
    expected: 'accepted',
    note: 'Canonical order, and what the SDK signMessage helper sends.'
  },
  {
    id: 'personal-sign-reversed',
    label: 'personal_sign [signer, message]',
    method: 'personal_sign',
    buildParams: signer => [signer, toHex(MESSAGE)],
    expected: 'rejected',
    note: 'Wallets sign param 0, so this signs the address while the page previews the message.'
  },
  {
    id: 'personal-sign-one-param',
    label: 'personal_sign [message]',
    method: 'personal_sign',
    buildParams: () => [toHex(MESSAGE)],
    expected: 'rejected',
    note: 'The params must be exactly two.'
  },
  {
    id: 'personal-sign-extra-param',
    label: 'personal_sign [message, signer, x]',
    method: 'personal_sign',
    buildParams: signer => [toHex(MESSAGE), signer, 'extra'],
    expected: 'rejected',
    note: 'The params must be exactly two, a trailing one included.'
  },
  {
    id: 'personal-sign-both-signer',
    label: 'personal_sign [signer, signer]',
    method: 'personal_sign',
    buildParams: signer => [signer, signer],
    expected: 'rejected',
    note: 'Nothing here can be told apart from the address.'
  },
  {
    id: 'personal-sign-other-address',
    label: 'personal_sign [message, other]',
    method: 'personal_sign',
    buildParams: () => [toHex(MESSAGE), OTHER_ADDRESS],
    expected: 'rejected',
    note: 'Param 1 has to be the connected signer.'
  },
  {
    id: 'personal-sign-object-message',
    label: 'personal_sign [{ text }, signer]',
    method: 'personal_sign',
    buildParams: signer => [{ text: MESSAGE }, signer],
    expected: 'rejected',
    note: 'The message has to be a string.'
  },
  {
    id: 'typed-data-canonical',
    label: 'v4 [signer, typed data]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [signer, JSON.stringify(statement())],
    expected: 'accepted',
    note: 'Canonical order, payload as the JSON string wallets expect.'
  },
  {
    id: 'typed-data-object',
    label: 'v4 [signer, typed data object]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [signer, statement()],
    expected: 'accepted',
    note: 'Same request with the payload already parsed, which the guard also allows.'
  },
  {
    id: 'typed-data-decoy',
    label: 'v4 [decoy, permit]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [JSON.stringify(statement()), JSON.stringify(permit(signer))],
    expected: 'rejected',
    note: 'The one that matters: the page previews param 0, the wallet is handed param 1.'
  },
  {
    id: 'typed-data-legacy-order',
    label: 'v4 [typed data, signer]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [JSON.stringify(statement()), signer],
    expected: 'rejected',
    note: 'The v1 param order under a v4 method.'
  },
  {
    id: 'typed-data-not-json',
    label: 'v4 [signer, "{not json"]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [signer, '{not json'],
    expected: 'rejected',
    note: 'Param 1 has to parse.'
  },
  {
    id: 'typed-data-no-primary-type',
    label: 'v4 [signer, v1 field list]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [signer, JSON.stringify(fieldList())],
    expected: 'rejected',
    note: 'A v1 field list parses but carries no primaryType.'
  },
  {
    id: 'typed-data-other-address',
    label: 'v4 [other, typed data]',
    method: 'eth_signTypedData_v4',
    buildParams: signer => [OTHER_ADDRESS, JSON.stringify(permit(signer))],
    expected: 'rejected',
    note: 'Param 0 has to be the connected signer.'
  },
  {
    id: 'typed-data-v1',
    label: 'eth_signTypedData (v1)',
    method: 'eth_signTypedData',
    buildParams: signer => [JSON.stringify(fieldList()), signer],
    expected: 'blocked-upstream',
    note: 'Dropped from the auth allowlist by #463, but the explorer whitelist stops it first.'
  }
]
