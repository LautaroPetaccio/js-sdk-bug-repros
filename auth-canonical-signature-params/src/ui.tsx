import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Button, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { CASES, Expected, SignatureCase } from './cases'

/** Where a case is in its round trip. */
export type Status = 'idle' | 'in-flight' | 'signed' | 'no-signature' | 'error'

export type CaseState = {
  status: Status
  /** Milliseconds between the click and the callback. Tells a local block from an auth-site one. */
  elapsedMs: number
  detail: string
}

export type UiState = {
  signer: string
  /** How the address was found, or why it could not be. Shown so a dead panel explains itself. */
  signerNote: string
  /** The case currently occupying the explorer's single web3 slot, if any. */
  pending: string | null
  /** Updated on EVERY click, refusals included, so a click that does nothing still says so. */
  lastAction: string
  clicks: number
  cases: Record<string, CaseState>
  onRun: (signatureCase: SignatureCase) => void
  onReset: () => void
}

export const state: UiState = {
  signer: '',
  signerNote: 'looking up the connected address...',
  pending: null,
  lastAction: 'no button pressed yet',
  clicks: 0,
  cases: {},
  onRun: () => {},
  onReset: () => {}
}

for (const signatureCase of CASES) {
  state.cases[signatureCase.id] = { status: 'idle', elapsedMs: 0, detail: '' }
}

const WHITE = Color4.create(0.92, 0.92, 0.94, 1)
const GREY = Color4.create(0.62, 0.62, 0.66, 1)
const GREEN = Color4.create(0.36, 0.82, 0.45, 1)
const RED = Color4.create(0.92, 0.36, 0.36, 1)
const AMBER = Color4.create(0.95, 0.75, 0.3, 1)

/** Whether the outcome is the one auth#463 is supposed to produce. */
export function matchesExpectation(expected: Expected, status: Status): boolean | null {
  if (status === 'idle' || status === 'in-flight') return null
  return expected === 'accepted' ? status === 'signed' : status !== 'signed'
}

function statusLine(signatureCase: SignatureCase, caseState: CaseState): string {
  switch (caseState.status) {
    case 'idle':
      return `expects ${signatureCase.expected}`
    case 'in-flight':
      return 'waiting on the auth tab...'
    case 'signed':
      return `signed after ${(caseState.elapsedMs / 1000).toFixed(1)}s`
    case 'error':
      return `rpc error: ${caseState.detail}`
    default:
      // Under a second means the explorer refused it locally; longer means the auth site was reached
      // and never sent an outcome, so the request sat until it expired.
      return caseState.elapsedMs < 3000
        ? `no signature, blocked locally in ${caseState.elapsedMs}ms`
        : `no signature after ${(caseState.elapsedMs / 1000).toFixed(0)}s`
  }
}

function statusColor(signatureCase: SignatureCase, caseState: CaseState): Color4 {
  const matched = matchesExpectation(signatureCase.expected, caseState.status)
  if (matched === null) return caseState.status === 'in-flight' ? AMBER : GREY
  return matched ? GREEN : RED
}

const Row = ({ signatureCase }: { key: string; signatureCase: SignatureCase }) => {
  const caseState = state.cases[signatureCase.id]
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 28,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 3 }
      }}
    >
      <Button
        value={signatureCase.label}
        variant={signatureCase.expected === 'accepted' ? 'primary' : 'secondary'}
        fontSize={12}
        uiTransform={{ width: 300, height: 26, flexShrink: 0 }}
        onMouseDown={() => state.onRun(signatureCase)}
      />
      <Label
        value={statusLine(signatureCase, caseState)}
        color={statusColor(signatureCase, caseState)}
        fontSize={12}
        uiTransform={{ width: 320, height: 26, flexShrink: 0 }}
      />
    </UiEntity>
  )
}

export const Panel = () => (
  <UiEntity
    uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
  >
    <UiEntity
      uiTransform={{ width: 660, flexDirection: 'column', flexShrink: 0, padding: 16 }}
      uiBackground={{ color: Color4.create(0.07, 0.07, 0.1, 0.92) }}
    >
      <Label value="auth#463 - canonical signature params" color={WHITE} fontSize={16} />
      <Label
        value={state.signer === '' ? state.signerNote : `signer ${state.signer} (${state.signerNote})`}
        color={state.signer === '' ? RED : GREY}
        fontSize={12}
      />
      <Label
        value={`${state.clicks} click(s) | ${state.lastAction}`}
        color={state.pending === null ? GREY : AMBER}
        fontSize={12}
      />
      {CASES.map(signatureCase => (
        <Row key={signatureCase.id} signatureCase={signatureCase} />
      ))}
      <Button
        value="reset readout"
        variant="secondary"
        fontSize={12}
        uiTransform={{ width: 140, height: 26, flexShrink: 0, margin: { top: 6 } }}
        onMouseDown={() => state.onReset()}
      />
    </UiEntity>
  </UiEntity>
)
