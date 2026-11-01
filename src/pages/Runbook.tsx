import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAccount, useTransactionReceipt } from 'wagmi'
import { Check } from 'lucide-react'
import { CHAIN, CHAIN_ID, IS_MAINNET } from '@/lib/env'
import { fmtDateTime, fmtDuration, fmtUsdc, sameAddress } from '@/lib/format'
import { findSim, readSims, type SimRecord } from '@/lib/liveEvidence'
import { Link } from '@/lib/router'
import { RUNBOOK_PRESETS, RUNBOOK_WALLETS } from '@/lib/runbook'
import type { Agreement, ArcEvent } from '@/lib/types'
import { useChainData } from '@/state/ChainData'
import { AddressChip, Card, DataBadge, Notice, PageHeader, SetupRequired, TxLink } from '@/components/ui'

interface Step {
  title: string
  who: string
  body: ReactNode
  done: boolean
  /** "chain" = read from the contract; "browser" = a simulation remembered in this browser. */
  source: 'chain' | 'browser'
  note?: ReactNode
  action?: ReactNode
  tx?: ArcEvent
}

function useSims(): SimRecord[] {
  const [sims, setSims] = useState<SimRecord[]>(() => readSims())
  useEffect(() => {
    const update = () => setSims(readSims())
    window.addEventListener('arcsla-sims', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('arcsla-sims', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return sims
}

function TxEvidence({ event }: { event: ArcEvent }) {
  const receipt = useTransactionReceipt({ hash: event.txHash, chainId: CHAIN_ID })
  return (
    <div className="mt-2 rounded-xl p-3 text-xs" style={{ background: 'var(--surface-muted)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TxLink hash={event.txHash} />
        <span>block {event.blockNumber.toString()}</span>
        {receipt.data && (
          <>
            <span>status {receipt.data.status}</span>
            <span className="tabular-nums">gas used {receipt.data.gasUsed.toString()}</span>
          </>
        )}
        {receipt.isLoading && <span style={{ color: 'var(--subtle)' }}>reading receipt…</span>}
      </div>
    </div>
  )
}

export default function Runbook() {
  const data = useChainData()
  const { address } = useAccount()
  const sims = useSims()

  const steps = useMemo(() => {
    const byId = (id: bigint): Agreement | undefined => data.agreements.find((a) => a.id === id)
    const ev = (id: bigint, kind: ArcEvent['kind']) => data.events.find((e) => e.id === id && e.kind === kind)
    const nextId = data.agreementCount !== undefined ? data.agreementCount + 1n : undefined

    const build = (key: 't1' | 't1b'): Step[] => {
      const preset = RUNBOOK_PRESETS[key]
      const id = preset.expectedId
      const a = byId(id)
      const created = ev(id, 'created')
      const wrongRole = a && (!sameAddress(a.provider, RUNBOOK_WALLETS.provider) || !sameAddress(a.verifier, RUNBOOK_WALLETS.verifier))
      const expectedAmount = 100000n
      const createStep: Step = {
        title: `Create and fund agreement #${id}`,
        who: 'Customer wallet',
        body: `Fund ${preset.amount} test USDC with a deadline about ${preset.deadlineMinutes} minutes ahead. Two wallet prompts: allow USDC, then create. Roles are pre-filled; check every field.${key === 't1b' ? ' The deadline is fixed when the form opens, so after confirming "Allow USDC" reopen the pre-filled form before pressing "Create & fund" to get a fresh 5-minute window.' : ''}`,
        done: !!a,
        source: 'chain',
        tx: created,
        note: a ? (
          <>
            Found #{a.id.toString()}: {fmtUsdc(a.amount)} USDC, deadline in {fmtDuration(Math.abs(Number(a.deadline) - Number(a.createdAt)))} from creation, status {['Active', 'Released', 'Refunded'][a.status]}.
            {a.amount !== expectedAmount && ' Amount differs from the 0.10 plan.'}
            {wrongRole && ' Provider or verifier differs from the planned wallets.'}
          </>
        ) : nextId !== undefined && nextId !== id ? (
          `The next agreement will be #${nextId.toString()}, not #${id.toString()}. This runbook tracks #${id.toString()} only.`
        ) : undefined,
        action: a ? undefined : <Link to={`/create?preset=${key}`} className="btn btn-primary">Open pre-filled form</Link>,
      }

      if (key === 't1') {
        const wrong = findSim(sims, id, 'wrongSigner')
        const tampered = findSim(sims, id, 'tampered')
        const valid = findSim(sims, id, 'validAccepted')
        const dup = findSim(sims, id, 'duplicateRelease')
        const earlyT1 = findSim(sims, id, 'earlyRefund')
        const released = a?.status === 1
        return [
          createStep,
          {
            title: 'Invalid verifier signature (no transaction)',
            who: 'Customer wallet (NOT the verifier)',
            body: 'In the verifier console, sign with a wallet that is not the verifier, then press "Check this signature". The contract should answer InvalidSigner.',
            done: wrong?.outcome === 'InvalidSigner',
            source: 'browser',
            note: wrong ? `Recorded in this browser: ${wrong.outcome}.` : undefined,
            action: a?.status === 0 ? <Link to={`/verifier?id=${id}`} className="btn btn-ghost">Open verifier console</Link> : undefined,
          },
          {
            title: 'Tampered signature (no transaction)',
            who: 'Verifier wallet',
            body: 'Sign with the verifier wallet (it needs no USDC to sign), then press "Test a tampered signature". Expect InvalidSigner.',
            done: tampered?.outcome === 'InvalidSigner',
            source: 'browser',
            note: tampered ? `Recorded in this browser: ${tampered.outcome}.` : undefined,
            action: a?.status === 0 ? <Link to={`/verifier?id=${id}`} className="btn btn-ghost">Open verifier console</Link> : undefined,
          },
          {
            title: 'Valid EIP-712 signature accepted (no transaction)',
            who: 'Verifier wallet',
            body: 'With the verifier wallet signature unchanged, press "Check this signature". The contract should say it would accept it.',
            done: valid?.outcome === 'accepted' || released,
            source: valid ? 'browser' : 'chain',
            note: valid ? 'Recorded in this browser: accepted.' : released ? 'The agreement is Released, so a valid signature was accepted onchain.' : undefined,
            action: a?.status === 0 ? <Link to={`/verifier?id=${id}`} className="btn btn-ghost">Open verifier console</Link> : undefined,
          },
          {
            title: 'Early refund is rejected (read-only simulation)',
            who: 'Any wallet',
            body: 'Before releasing, open the agreement page and press "Simulate early refund". It is simulated as the customer while the agreement is Active and before the deadline. Expect RefundNotAvailable.',
            done: earlyT1?.outcome === 'RefundNotAvailable',
            source: 'browser',
            note: earlyT1 ? `Recorded in this browser: ${earlyT1.outcome}.` : undefined,
            action: a?.status === 0 ? <Link to={`/agreement/${id}`} className="btn btn-ghost">Open agreement #{id.toString()}</Link> : undefined,
          },
          {
            title: 'Release payment to the provider (wallet confirmation)',
            who: 'Customer wallet (pays the gas; anyone may submit)',
            body: 'Press "Submit & release payment" and confirm in your wallet. Do this before the deadline.',
            done: released,
            source: 'chain',
            tx: ev(id, 'released'),
            note: a && a.status === 0 ? `Release window closes in ${fmtDuration(Math.max(0, Number(a.deadline) - data.now))}.` : undefined,
          },
          {
            title: 'Duplicate settlement is rejected (no transaction)',
            who: 'Any wallet',
            body: 'On the agreement page press "Simulate duplicate release". Expect AgreementNotActive.',
            done: dup?.outcome === 'AgreementNotActive',
            source: 'browser',
            note: dup ? `Recorded in this browser: ${dup.outcome}.` : undefined,
            action: released ? <Link to={`/agreement/${id}`} className="btn btn-ghost">Open agreement #{id.toString()}</Link> : undefined,
          },
        ]
      }

      const early = findSim(sims, id, 'earlyRefund')
      const dupRefund = findSim(sims, id, 'duplicateRefund')
      const deadline = a ? Number(a.deadline) : undefined
      const refunded = a?.status === 2
      const earlyValid = early?.outcome === 'RefundNotAvailable'
      return [
        createStep,
        {
          title: 'Early refund is rejected (read-only simulation)',
          who: 'Any wallet',
          body: 'Before the deadline, press "Simulate early refund" on the agreement page. It is simulated as the customer. Expect RefundNotAvailable.',
          done: earlyValid,
          source: 'browser',
          note: early ? `Recorded in this browser: ${early.outcome}.` : undefined,
          action: a ? <Link to={`/agreement/${id}`} className="btn btn-ghost">Open agreement #{id.toString()}</Link> : undefined,
        },
        {
          title: 'Wait for the deadline to pass',
          who: 'Nobody',
          body: 'Do nothing. The contract allows a refund only strictly after the deadline.',
          done: !!a && deadline !== undefined && data.now > deadline,
          source: 'chain',
          note: a && deadline !== undefined ? (data.now > deadline ? `Deadline passed ${fmtDuration(data.now - deadline)} ago (${fmtDateTime(a.deadline)}).` : `Deadline in ${fmtDuration(deadline - data.now)} (${fmtDateTime(a.deadline)}).`) : undefined,
        },
        {
          title: 'Refund to the customer (wallet confirmation)',
          who: 'Customer wallet',
          body: 'On the agreement page press "Claim refund" and confirm in your wallet.',
          done: refunded,
          source: 'chain',
          tx: ev(id, 'refunded'),
          action: a && a.status === 0 && deadline !== undefined && data.now > deadline ? <Link to={`/agreement/${id}`} className="btn btn-primary">Open agreement #{id.toString()}</Link> : undefined,
        },
        {
          title: 'Duplicate refund is rejected (no transaction)',
          who: 'Any wallet',
          body: 'On the agreement page press "Simulate duplicate refund". Expect AgreementNotActive.',
          done: dupRefund?.outcome === 'AgreementNotActive',
          source: 'browser',
          note: dupRefund ? `Recorded in this browser: ${dupRefund.outcome}.` : undefined,
          action: refunded ? <Link to={`/agreement/${id}`} className="btn btn-ghost">Open agreement #{id.toString()}</Link> : undefined,
        },
      ]
    }
    return { t1: build('t1'), t1b: build('t1b') }
  }, [data.agreements, data.events, data.now, data.agreementCount, sims])

  if (IS_MAINNET) {
    return (
      <>
        <PageHeader title="Live testnet runbook" />
        <Notice tone="error">This runbook is for Arc Testnet only. The app is currently configured for {CHAIN.name}.</Notice>
      </>
    )
  }
  if (!data.configured) {
    return (
      <>
        <PageHeader title="Live testnet runbook" />
        <SetupRequired />
      </>
    )
  }

  const total = steps.t1.length + steps.t1b.length
  const done = [...steps.t1, ...steps.t1b].filter((s) => s.done).length
  const roleOf = (a?: string) =>
    sameAddress(a, RUNBOOK_WALLETS.customer) ? 'customer' : sameAddress(a, RUNBOOK_WALLETS.provider) ? 'provider' : sameAddress(a, RUNBOOK_WALLETS.verifier) ? 'verifier' : undefined

  return (
    <>
      <PageHeader
        title="Live testnet runbook"
        subtitle={`Tests T1 and T1b on ${CHAIN.name}. Real transactions with test USDC, each confirmed by you.`}
        action={<span className="display text-lg font-bold tabular-nums">{done}/{total}</span>}
      />

      <div className="space-y-3">
        <Notice tone="warn">
          This page never signs, approves or sends anything. Every transaction below is a button you press and a prompt you confirm in your own wallet. Steps tick off only from live contract state or from simulations recorded in this browser.
        </Notice>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="display text-lg font-semibold">Wallet roles</h2>
            <DataBadge kind="onchain" />
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div><p style={{ color: 'var(--subtle)' }} className="text-xs">Customer (pays 0.10 USDC + gas)</p><AddressChip address={RUNBOOK_WALLETS.customer} /></div>
            <div><p style={{ color: 'var(--subtle)' }} className="text-xs">Provider (receives the release)</p><AddressChip address={RUNBOOK_WALLETS.provider} /></div>
            <div><p style={{ color: 'var(--subtle)' }} className="text-xs">Verifier (signs, needs no USDC)</p><AddressChip address={RUNBOOK_WALLETS.verifier} /></div>
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
            {address
              ? roleOf(address)
                ? `Connected as the ${roleOf(address)} wallet.`
                : 'Connected wallet is not one of the three planned wallets.'
              : 'No wallet connected. Connect the wallet for the step you are about to do.'}
            {' '}Agreement #3 was used by an earlier create-and-refund run, so T1 is tracked on #4 (60-minute deadline). The optional T1b would be #5.
          </p>
        </Card>
      </div>

      {(['t1', 't1b'] as const).map((key) => (
        <section key={key} className="mt-6">
          <h2 className="display mb-3 text-2xl font-semibold">
            {key === 't1' ? 'T1: verified release (agreement #4, 60-minute deadline)' : 'T1b (optional): deadline refund (agreement #5)'}
          </h2>
          <ol className="space-y-3">
            {steps[key].map((step, i) => (
              <li key={step.title}>
                <Card className="!p-4 sm:!p-5">
                  <div className="flex gap-4">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums"
                      style={{ background: step.done ? 'var(--success)' : 'var(--surface-muted)', color: step.done ? '#fff' : 'var(--muted)' }}
                    >
                      {step.done ? <Check className="size-4" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold sm:text-base">{step.title}</h3>
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
                          {step.source === 'chain' ? 'Verified onchain' : 'Recorded in browser'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium" style={{ color: 'var(--accent-hover)' }}>Wallet: {step.who}</p>
                      <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--muted)' }}>{step.body}</p>
                      {step.note && <p className="mt-1.5 text-xs" style={{ color: 'var(--ink-2)' }}>{step.note}</p>}
                      {step.tx && <TxEvidence event={step.tx} />}
                      {step.action && <div className="mt-3">{step.action}</div>}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <Card className="mt-6">
        <h2 className="display text-lg font-semibold">Simulations recorded in this browser</h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          Read-only checks leave no onchain record, so they are remembered here. When you ask Arc Studio to record the results, paste this JSON into the chat so they can be included, labelled as browser-recorded.
        </p>
        <textarea readOnly rows={sims.length ? 6 : 2} className="input mono mt-2 text-xs" value={sims.length ? JSON.stringify(sims, null, 2) : 'No simulations recorded yet.'} />
      </Card>

      <p className="mt-6 text-sm" style={{ color: 'var(--muted)' }}>
        When you have finished, ask Arc Studio to record the results. It reads the receipts and event logs from the chain and writes them to <span className="mono">docs/TESTNET_ADVERSARIAL_EVIDENCE.md</span>.
      </p>
    </>
  )
}
