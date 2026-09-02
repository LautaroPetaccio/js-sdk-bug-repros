import { Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { createEthereumProvider } from '@dcl/sdk/ethereum-provider'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { CASES, SignatureCase } from './cases'
import { resolveSigner } from './signer'
import { Panel, matchesExpectation, state } from './ui'

const provider = createEthereumProvider()

let sign: Entity
let nextRequestId = 1
let rendered = ''

type RpcResponse = { result?: unknown }

/**
 * The explorer swallows every wallet failure into `result: null` rather than an rpc error, so a
 * rejected request and a denied one look the same from here. Which one it was is on the auth tab.
 */
function send(method: string, params: unknown[]): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    provider.sendAsync({ jsonrpc: '2.0', id: nextRequestId++, method, params: params as any[] }, (error, result) => {
      if (error) reject(error)
      else resolve(result as RpcResponse)
    })
  })
}

/** Every exit from a click goes through here, so a button press always leaves a visible mark. */
function note(message: string) {
  state.lastAction = message
  console.log(message)
  render()
}

async function lookUpSigner() {
  const { signer, source, tried } = await resolveSigner()
  state.signer = signer
  state.signerNote = signer === '' ? `no address: ${tried.join('; ')}` : `via ${source}`
  console.log(state.signer === '' ? state.signerNote : `connected signer: ${signer} (via ${source})`)
  render()
}

async function run(signatureCase: SignatureCase) {
  state.clicks++

  if (state.pending !== null) {
    note(`${signatureCase.id}: ignored, "${state.pending}" holds the explorer's single web3 slot`)
    return
  }

  if (state.signer === '') {
    // Worth a second look before giving up: the identity is not always ready when the scene starts.
    note(`${signatureCase.id}: no signer yet, looking again...`)
    await lookUpSigner()
    if (state.signer === '') {
      note(`${signatureCase.id}: no wallet connected. ${state.signerNote}`)
      return
    }
  }

  const params = signatureCase.buildParams(state.signer)
  const caseState = state.cases[signatureCase.id]
  caseState.status = 'in-flight'
  caseState.elapsedMs = 0
  caseState.detail = ''
  state.pending = signatureCase.id

  console.log(`--- ${signatureCase.id} (expects ${signatureCase.expected})`)
  console.log(`    ${signatureCase.note}`)
  console.log(`    ${JSON.stringify({ method: signatureCase.method, params })}`)
  note(`${signatureCase.id}: sent, expects ${signatureCase.expected}`)

  const startedAt = Date.now()
  try {
    const response = await send(signatureCase.method, params)
    caseState.elapsedMs = Date.now() - startedAt
    const signature = response.result
    if (typeof signature === 'string' && signature.length > 0) {
      caseState.status = 'signed'
      caseState.detail = signature
    } else {
      caseState.status = 'no-signature'
      caseState.detail = JSON.stringify(response)
    }
  } catch (e) {
    caseState.elapsedMs = Date.now() - startedAt
    caseState.status = 'error'
    caseState.detail = e instanceof Error ? e.message : String(e)
  }

  state.pending = null
  note(`${signatureCase.id}: ${caseState.status} after ${caseState.elapsedMs}ms`)
}

function reset() {
  for (const signatureCase of CASES) {
    state.cases[signatureCase.id] = { status: 'idle', elapsedMs: 0, detail: '' }
  }
  state.clicks++
  note('readout cleared')
}

function summary(): { text: string; color: Color4 } {
  let matched = 0
  let mismatched = 0
  let sent = 0

  for (const signatureCase of CASES) {
    const result = matchesExpectation(signatureCase.expected, state.cases[signatureCase.id].status)
    if (result === null) continue
    sent++
    if (result) matched++
    else mismatched++
  }

  if (sent === 0) {
    return { text: `${CASES.length} cases, none sent yet`, color: Color4.White() }
  }
  if (mismatched > 0) {
    return { text: `MISMATCH: ${mismatched} of ${sent} case(s) sent did not behave as #463 says`, color: Color4.Red() }
  }
  return { text: `AS EXPECTED: ${matched} of ${CASES.length} case(s) sent behaved as #463 says`, color: Color4.Green() }
}

function render() {
  const rollup = summary()
  const lines = ['signature requests the auth site accepts and rejects', rollup.text, state.lastAction]

  for (const signatureCase of CASES) {
    const caseState = state.cases[signatureCase.id]
    if (caseState.status === 'idle') continue
    lines.push(`${signatureCase.id}: ${caseState.status}`)
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.1,
    textColor: rollup.color,
    width: 16,
    height: 8
  })
  console.log(text)
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2.4, 8) })

  state.onRun = signatureCase => {
    void run(signatureCase)
  }
  state.onReset = reset

  ReactEcsRenderer.setUiRenderer(Panel)

  lookUpSigner().catch(e => {
    state.signerNote = `signer lookup failed: ${e instanceof Error ? e.message : String(e)}`
    render()
  })

  render()
}
