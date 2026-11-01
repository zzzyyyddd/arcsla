import { useMemo, useState, type ReactNode } from 'react'
import { usePublicClient } from 'wagmi'
import type { PublicClient } from 'viem'
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react'
import { markRejectionTested } from '@/lib/attestation'
import { ARCSLA_ADDRESS, CHAIN, CHAIN_ID } from '@/lib/env'
import { Link } from '@/lib/router'
import {
  UNAVAILABLE_TITLE,
  loadOriginalAttestation,
  runRejectionDemo,
  type OriginalAttestation,
  type Outcome,
  type RejectionResult,
} from '@/lib/rejection-demo'
import { useChainData } from '@/state/ChainData'
import { AddressChip, Notice, TxLink } from '@/components/ui'

type State =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'inconclusive'; detail: string; result?: RejectionResult }
  | { phase: 'done'; result: RejectionResult; attestation: OriginalAttestation; agreementId: bigint }

const TAGS = {
  onchain: { label: 'Onchain evidence', bg: 'rgba(14,138,95,0.12)', fg: '#0b6b4a' },
  simulation: { label: 'Read-only simulation', bg: 'rgba(16,97,166,0.10)', fg: '#0d4d84' },
  local: { label: 'Browser-local note', bg: 'rgba(100,110,130,0.14)', fg: '#4a5368' },
} as const

function Tag({ kind }: { kind: keyof typeof TAGS }) {
  const t = TAGS[kind]
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest" style={{ background: t.bg, color: t.fg }}>
      {t.label}
    </span>
  )
}

const outcomeText = (o: Outcome) => (o.kind === 'accepted' ? 'Accepted (would settle)' : `Rejected: ${o.name}`)

/** Step 9 of the Guided Demo: a read-only rejection test using the original attestation of a settled agreement. */
export function RejectionTest({ onCompleted }: { onCompleted: () => void }) {
  const data = useChainData()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const [state, setState] = useState<State>({ phase: 'idle' })

  // The lowest-numbered settled-by-release agreement, because only a release carries an attestation.
  const target = useMemo(() => data.agreements.filter((a) => a.status === 1).sort((x, y) => (x.id < y.id ? -1 : 1))[0], [data.agreements])
  const releasedEvent = target ? data.events.find((e) => e.kind === 'released' && e.id === target.id) : undefined

  async function run() {
    if (!client || !ARCSLA_ADDRESS) return
    if (!target) {
      setState({ phase: 'unavailable', reason: `No agreement on ${CHAIN.name} has been released yet, so there is no original attestation to test.` })
      return
    }
    setState({ phase: 'running' })
    const ctx = { client: client as unknown as PublicClient, arcsla: ARCSLA_ADDRESS, chainId: CHAIN_ID }
    const loaded = await loadOriginalAttestation(ctx, target, releasedEvent?.txHash)
    if (!loaded.ok) {
      setState({ phase: 'unavailable', reason: loaded.reason })
      return
    }
    try {
      const result = await runRejectionDemo(ctx, target, loaded.attestation, releasedEvent?.at ?? target.createdAt)
      if (result.rejected) {
        markRejectionTested('InvalidSigner', { via: 'demo', agreementId: target.id.toString(), releaseTx: loaded.attestation.txHash })
        onCompleted()
        setState({ phase: 'done', result, attestation: loaded.attestation, agreementId: target.id })
      } else {
        setState({
          phase: 'inconclusive',
          result,
          detail: result.copyMatchesAgreement
            ? 'The network did not return the expected pair of answers (control accepted, tampered signature rejected with InvalidSigner), so nothing was recorded.'
            : 'This RPC endpoint could not evaluate the temporary Active copy, so the test cannot be completed here. Nothing was recorded.',
        })
      }
    } catch {
      setState({ phase: 'inconclusive', detail: 'The network request failed. Nothing was recorded. Try again.' })
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={state.phase === 'running' || !client}>
        {state.phase === 'running' ? 'Running read-only test…' : 'Run the read-only rejection test'}
      </button>
      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        {target
          ? `Uses the original signed attestation of settled agreement #${target.id.toString()} on ${CHAIN.name}. No transaction, no wallet prompt, no USDC.`
          : `No released agreement exists on ${CHAIN.name} yet.`}
      </p>

      {state.phase === 'unavailable' && (
        <Notice tone="warn">
          <span className="font-semibold">{UNAVAILABLE_TITLE}.</span> {state.reason} Nothing was recorded and step 9 stays open. Or{' '}
          <Link to="/verifier" className="font-semibold underline">use the verifier console</Link> on an active agreement.
        </Notice>
      )}
      {state.phase === 'inconclusive' && (
        <Notice tone="warn">
          <span className="font-semibold">Test inconclusive.</span> {state.detail}
        </Notice>
      )}

      {state.phase === 'done' && <Results state={state} />}
    </div>
  )
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Results({ state }: { state: Extract<State, { phase: 'done' }> }) {
  const { result: r, attestation: att, agreementId } = state
  const ok = <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
  const no = <XCircle className="size-4" style={{ color: 'var(--danger)' }} />
  const info = <ShieldAlert className="size-4" style={{ color: 'var(--warn)' }} />
  return (
    <div className="inner space-y-4 p-4" role="status">
      <div>
        <div className="mb-1.5 flex items-center gap-2"><Tag kind="onchain" /></div>
        <ul className="space-y-1.5">
          <Row icon={ok}>Agreement #{agreementId.toString()} is <strong>Released</strong> (read from the contract).</Row>
          <Row icon={ok}>Original release transaction: <TxLink hash={att.txHash} /></Row>
          <Row icon={ok}>
            Its signature recovers locally to <AddressChip address={att.recoveredSigner} />, the agreement’s verifier.
          </Row>
        </ul>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2"><Tag kind="simulation" /></div>
        <ul className="space-y-1.5">
          <Row icon={info}>
            Real agreement + original signature: <strong>{outcomeText(r.realState)}</strong>. It is already settled and the contract checks that before the
            signature, so this line is not a signature test.
          </Row>
          <Row icon={ok}>
            Temporary Active copy + original signature (control): <strong>{outcomeText(r.control)}</strong>.
          </Row>
          <Row icon={r.tampered.kind === 'rejected' ? ok : no}>
            Same copy, signature with byte {r.tamperedByte.index} changed ({r.tamperedByte.before} → {r.tamperedByte.after}): <strong>{outcomeText(r.tampered)}</strong>.
          </Row>
        </ul>
        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          The “Active copy” exists only inside these read-only calls, evaluated at chain time {r.simulatedAt.toString()} (when the original release happened).
          Nothing was sent, no wallet prompt appeared, no USDC moved and the real agreement is unchanged.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2"><Tag kind="local" /></div>
        <p className="text-sm">Step 9 is marked complete in this browser only. This note is not an onchain record.</p>
      </div>
    </div>
  )
}
