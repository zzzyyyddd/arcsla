import { useState } from 'react'
import { keccak256, toBytes, type Hex } from 'viem'
import { usePublicClient } from 'wagmi'
import { FlaskConical } from 'lucide-react'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { ARCSLA_ADDRESS, CHAIN_ID } from '@/lib/env'
import { findRevertName, REVERT_COPY } from '@/lib/format'
import { recordSim, type SimKind } from '@/lib/liveEvidence'
import type { Agreement } from '@/lib/types'
import { useChainData } from '@/state/ChainData'
import { Card, DataBadge, Notice } from './ui'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ZERO_SIGNATURE: Hex = `0x${'00'.repeat(65)}`

interface Outcome {
  ok: boolean
  name: string
  copy: string
}

/**
 * Read-only checks (eth_call): the contract's own rules evaluated against the current chain
 * state. No wallet prompt, no transaction, no gas. Results are remembered in this browser only.
 */
export function SimulationCard({ agreement }: { agreement: Agreement }) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { now } = useChainData()
  const [outcomes, setOutcomes] = useState<Partial<Record<SimKind, Outcome>>>({})
  const [busy, setBusy] = useState<SimKind>()

  if (!ARCSLA_ADDRESS) return null
  const arcsla = ARCSLA_ADDRESS

  const active = agreement.status === 0
  const deadline = Number(agreement.deadline)

  const run = async (kind: SimKind, call: () => Promise<unknown>) => {
    setBusy(kind)
    let outcome: Outcome
    try {
      await call()
      outcome = { ok: true, name: 'accepted', copy: 'The contract would accept this call right now.' }
    } catch (error) {
      const name = findRevertName(error) ?? 'Reverted'
      outcome = { ok: false, name, copy: REVERT_COPY[name] ?? 'The contract rejected this call.' }
    }
    setOutcomes((prev) => ({ ...prev, [kind]: outcome }))
    recordSim({ agreementId: agreement.id.toString(), kind, outcome: outcome.name, atChainTime: now, deadline })
    setBusy(undefined)
  }

  // Refund is simulated AS THE CUSTOMER so the result shows the timing rule, not the role rule.
  const simulateRefund = (kind: SimKind) =>
    run(kind, () =>
      client!.simulateContract({ address: arcsla, abi: arcSlaAbi, functionName: 'refund', args: [agreement.id], account: agreement.customer }),
    )

  // The contract checks "is still Active" before it looks at the signature, so any signature
  // is refused on a settled agreement. The values below are only placeholders for that check.
  const simulateDuplicateRelease = () =>
    run('duplicateRelease', () =>
      client!.simulateContract({
        address: arcsla,
        abi: arcSlaAbi,
        functionName: 'release',
        args: [
          agreement.id,
          agreement.specHash,
          agreement.provider,
          agreement.evidenceHash !== ZERO_HASH ? agreement.evidenceHash : keccak256(toBytes('duplicate-settlement-probe')),
          BigInt(now + 3600),
          ZERO_SIGNATURE,
        ],
      }),
    )

  const renderResult = (kind: SimKind) => {
    const o = outcomes[kind]
    if (!o) return null
    return (
      <div className="mt-2">
        <Notice tone={o.ok ? 'warn' : 'info'}>
          <span className="font-semibold">{o.name}</span>: {o.copy} (simulated, no transaction sent)
        </Notice>
      </div>
    )
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="display flex items-center gap-2 text-xl font-semibold">
          <FlaskConical className="size-5" /> Read-only checks
        </h2>
        <DataBadge kind="onchain" />
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        Ask the contract what it would do right now. These are simulations: no wallet prompt, no gas, nothing is sent.
      </p>

      <div className="mt-4 space-y-4">
        {active && (
          <div>
            <p className="text-sm font-semibold">{now <= deadline ? 'Early refund (before the deadline)' : 'Refund (deadline has passed)'}</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Simulated as the customer wallet. {now <= deadline ? 'Expected: RefundNotAvailable.' : 'Expected: accepted.'}
            </p>
            <button className="btn btn-ghost mt-2" disabled={!client || busy !== undefined} onClick={() => void simulateRefund('earlyRefund')}>
              {busy === 'earlyRefund' ? 'Checking…' : now <= deadline ? 'Simulate early refund' : 'Simulate refund now'}
            </button>
            {renderResult('earlyRefund')}
          </div>
        )}

        {!active && (
          <>
            <div>
              <p className="text-sm font-semibold">Duplicate release</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Expected: AgreementNotActive, because this agreement is already settled.</p>
              <button className="btn btn-ghost mt-2" disabled={!client || busy !== undefined} onClick={() => void simulateDuplicateRelease()}>
                {busy === 'duplicateRelease' ? 'Checking…' : 'Simulate duplicate release'}
              </button>
              {renderResult('duplicateRelease')}
            </div>
            <div>
              <p className="text-sm font-semibold">Duplicate refund</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Simulated as the customer wallet. Expected: AgreementNotActive.</p>
              <button className="btn btn-ghost mt-2" disabled={!client || busy !== undefined} onClick={() => void simulateRefund('duplicateRefund')}>
                {busy === 'duplicateRefund' ? 'Checking…' : 'Simulate duplicate refund'}
              </button>
              {renderResult('duplicateRefund')}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
