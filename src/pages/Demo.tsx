import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAccount } from 'wagmi'
import { Check } from 'lucide-react'
import { readRejectionTested } from '@/lib/attestation'
import {
  computeJourneySteps, listJourneys, markRolesSeen, readRolesSeen, selectJourney, summarizeSteps,
  type Role, type SeenStore, type StepResult,
} from '@/lib/demo-journey'
import { CHAIN, CHAIN_ID, IS_MAINNET } from '@/lib/env'
import { Link } from '@/lib/router'
import { useChainData } from '@/state/ChainData'
import { useJourneyReceipts } from '@/hooks/useJourneyReceipts'
import { AddressChip, Card, DataBadge, Notice, PageHeader, SetupRequired, TxLink } from '@/components/ui'
import { RejectionTest } from '@/components/RejectionTest'

const JOURNEY_KEY = `arcsla.demoJourney.${CHAIN_ID}`
const browserStore: SeenStore = {
  get: (k) => { try { return window.localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { window.localStorage.setItem(k, v) } catch { /* storage unavailable: progress simply is not remembered */ } },
}
const ROLE_LABEL: Record<Role, string> = { customer: 'customer', verifier: 'verifier', provider: 'provider' }

interface StepCopy { title: string; body: string; action?: ReactNode; note?: ReactNode }

export default function Demo() {
  const data = useChainData()
  const { address, isConnected } = useAccount()
  const [rejection, setRejection] = useState(() => readRejectionTested())
  const refreshRejection = useCallback(() => setRejection(readRejectionTested()), [])
  const [preferred, setPreferred] = useState<string | null>(() => browserStore.get(JOURNEY_KEY))

  // The connected wallet only decides WHICH journey is shown; it never decides whether an onchain step is complete.
  const selection = selectJourney({ agreements: data.agreements, wallet: address, preferredKey: preferred })
  const journey = selection.journey
  const journeys = listJourneys(data.agreements)

  // Remember (browser-local) which journey roles this browser has connected, so switching wallets back does not undo step 3.
  const journeyKey = journey?.key
  const rolesNow = selection.mode === 'participant' ? selection.roles : []
  const rolesNowKey = rolesNow.join(',')
  useEffect(() => {
    if (journeyKey && rolesNowKey) markRolesSeen(browserStore, CHAIN_ID, journeyKey, rolesNowKey.split(',') as Role[])
  }, [journeyKey, rolesNowKey])
  const rolesSeen = [...new Set([...(journey ? readRolesSeen(browserStore, CHAIN_ID, journey.key) : []), ...rolesNow])]
  const chooseJourney = (key: string) => { browserStore.set(JOURNEY_KEY, key); setPreferred(key) }

  const hashes = data.events.filter((e) => e.kind !== 'created' && journey?.agreements.some((a) => a.id === e.id)).map((e) => e.txHash)
  const receipts = useJourneyReceipts(hashes)
  const results = computeJourneySteps({
    selection, wallet: address, isConnected, events: data.events, receipts,
    rolesSeen, rejection,
  })
  const summary = summarizeSteps(results)
  const list = journey?.agreements ?? []
  const activeToVerify = list.find((a) => a.status === 0 && data.now <= Number(a.deadline))
  const expiredActive = list.find((a) => a.status === 0 && data.now > Number(a.deadline))
  const firstActive = list.find((a) => a.status === 0)
  const releaseEvent = data.events.find((e) => e.kind === 'released' && list.some((a) => a.id === e.id))

  const copy: StepCopy[] = [
    {
      title: 'Connect the customer wallet',
      body: IS_MAINNET
        ? `Use an account holding real USDC on ${CHAIN.name}. It also pays gas. Use only an amount you can afford to lose.`
        : `Use an account holding ${CHAIN.name} test USDC. Get it from the Get test USDC button in the Arc Studio sidebar.`,
      action: !isConnected && !journey ? <span className="text-xs" style={{ color: 'var(--muted)' }}>Use Connect in the header</span> : undefined,
    },
    {
      title: 'Create and fund a small agreement',
      body: IS_MAINNET
        ? 'Pick a second wallet as provider and a third, independent wallet as verifier. Use the smallest amount that is meaningful, with a deadline of 1 hour. This is real USDC.'
        : 'Pick a second wallet as provider and a third as verifier. Try 1 test USDC with a deadline of 1 hour.',
      action: <Link to="/create" className="btn btn-ghost">Create agreement</Link>,
    },
    {
      title: 'Connect the verifier wallet',
      body: 'Switch accounts in your wallet to the verifier you named. This step completes when that wallet has been connected here, or once the contract has accepted its signature onchain.',
    },
    {
      title: 'Sign a fulfillment attestation',
      body: 'Enter an evidence reference and sign the EIP-712 typed data. Nothing is sent onchain by signing.',
      action: activeToVerify ? <Link to={`/verifier?id=${activeToVerify.id}`} className="btn btn-ghost">Open verifier console</Link> : <Link to="/verifier" className="btn btn-ghost">Open verifier console</Link>,
      note: 'Completes once the contract has accepted the verifier’s signature (a release).',
    },
    {
      title: 'Release payment to the provider',
      body: 'Submit the signed attestation. The contract verifies the signer and moves the escrow to the provider in one transaction.',
    },
    {
      title: 'View the confirmed settlement transaction',
      body: 'Open the release transaction in the explorer and confirm the USDC transfer to the provider.',
      action: releaseEvent ? <TxLink hash={releaseEvent.txHash}>Open release transaction</TxLink> : undefined,
    },
    {
      title: 'Create a second agreement with a short deadline',
      body: 'Fund another agreement with a 10 minute deadline and do not attest it.',
      action: <Link to="/create" className="btn btn-ghost">Create short-deadline agreement</Link>,
    },
    {
      title: 'Let the deadline pass and claim the refund',
      body: 'After the deadline the release window closes. The customer claims the full escrow back.',
      action: expiredActive ? <Link to={`/agreement/${expiredActive.id}`} className="btn btn-primary">Claim refund</Link> : firstActive ? <Link to={`/agreement/${firstActive.id}`} className="btn btn-ghost">Watch the deadline</Link> : <Link to="/refunds" className="btn btn-ghost">Refund console</Link>,
    },
    {
      title: 'Watch an invalid signature get rejected',
      body: 'Takes the original signed attestation of a settled agreement from the chain, changes one byte, and asks the contract’s own verification (read-only, no transaction) whether it would accept it. Or use "Test a tampered signature" in the verifier console on an active agreement.',
      action: <RejectionTest onCompleted={refreshRejection} />,
    },
  ]
  const steps = results.map((r: StepResult, i) => ({ ...copy[i], ...r }))
  const sourceLabel = (s: StepResult) =>
    s.done ? (s.evidenceKind === 'onchain' ? 'Verified onchain' : 'Recorded in this browser') : s.id === 9 ? 'Recorded in browser when run' : 'Not complete'

  return (
    <>
      <PageHeader
        title="Guided demo"
        subtitle={`A nine step walkthrough of the full settlement lifecycle on ${CHAIN.name}.`}
        action={<span className="display text-lg font-bold tabular-nums">{summary.done}/{summary.total}</span>}
      />

      {IS_MAINNET && (
        <div className="mb-3">
          <Notice tone="error">
            You are on {CHAIN.name}. Every step below moves real USDC and cannot be undone. Rehearse on Arc Testnet first.
          </Notice>
        </div>
      )}
      {!IS_MAINNET && (
        <div className="mb-3">
          <Notice tone="info">
            Running the live T1 and T1b tests on {CHAIN.name}? <Link to="/demo/live" className="font-semibold underline">Open the live testnet runbook</Link>.
          </Notice>
        </div>
      )}
      <Notice tone="info">
        Progress follows one settlement journey (a customer and verifier pair), so switching wallets does not change it. Onchain steps come from agreement states, events and transaction receipts. Only the rejection test is stored in this browser, because a simulated call leaves no onchain record.
      </Notice>

      {!data.configured ? (
        <div className="mt-4"><SetupRequired /></div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <Card className="!p-4 sm:!p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="display text-base font-semibold">
                  {journey ? (selection.mode === 'participant' ? 'Your journey' : 'Recorded public journey') : 'No journey yet'}
                </h2>
                <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                  {summary.onchain} verified onchain{summary.browser > 0 ? ` · ${summary.browser} recorded in this browser` : ''}
                </span>
              </div>
              {journey ? (
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><dt className="w-20" style={{ color: 'var(--subtle)' }}>Customer</dt><dd><AddressChip address={journey.customer} /></dd></div>
                  <div className="flex flex-wrap items-center gap-2"><dt className="w-20" style={{ color: 'var(--subtle)' }}>Verifier</dt><dd><AddressChip address={journey.verifier} /></dd></div>
                  <div className="flex flex-wrap items-center gap-2"><dt className="w-20" style={{ color: 'var(--subtle)' }}>Provider</dt><dd className="flex flex-wrap gap-2">{journey.providers.map((p) => <AddressChip key={p} address={p} />)}</dd></div>
                </dl>
              ) : (
                <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>No agreement exists on {CHAIN.name} yet. Create one to start a journey.</p>
              )}
              <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
                {address
                  ? selection.roles.length > 0
                    ? <>Connected wallet is the <strong>{selection.roles.map((r) => ROLE_LABEL[r]).join(' and ')}</strong> of this journey. Switching to another participant keeps the same progress.</>
                    : <>Connected as {address.slice(0, 6)}…{address.slice(-4)}. Its role in this journey is not established.</>
                  : 'No wallet connected.'}
              </p>
              {journeys.length > 1 && (
                <label className="mt-3 block text-xs" style={{ color: 'var(--muted)' }}>
                  Journey{' '}
                  <select className="input !w-auto !py-1 text-xs" value={journey?.key ?? ''} onChange={(e) => chooseJourney(e.target.value)}>
                    {journeys.map((j) => (
                      <option key={j.key} value={j.key}>
                        {j.customer.slice(0, 6)}… → {j.verifier.slice(0, 6)}… ({j.agreements.length} agreement{j.agreements.length > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selection.notice && <div className="mt-3"><Notice tone="warn">{selection.notice}</Notice></div>}
            </Card>

            <ol className="space-y-3">
              {steps.map((step) => (
                <li key={step.title}>
                  <Card className="!p-4 sm:!p-5">
                    <div className="flex gap-4">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums"
                        style={{ background: step.done ? 'var(--success)' : 'var(--surface-muted)', color: step.done ? '#fff' : 'var(--muted)' }}
                      >
                        {step.done ? <Check className="size-4" /> : step.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold sm:text-base">{step.title}</h3>
                          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>{sourceLabel(step)}</span>
                        </div>
                        <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--muted)' }}>{step.body}</p>
                        {step.note && <p className="mt-1.5 text-xs" style={{ color: 'var(--ink-2)' }}>{step.note}</p>}
                        {step.evidence.map((e) => (
                          <p key={e.text} className="mt-1.5 text-xs" style={{ color: 'var(--ink-2)' }}>
                            {e.text} {e.txHash && <TxLink hash={e.txHash}>View transaction</TxLink>}
                          </p>
                        ))}
                        {step.reason && <p className="mt-1.5 text-xs" style={{ color: step.done ? 'var(--subtle)' : 'var(--muted)' }}>{step.reason}</p>}
                        {step.action && <div className="mt-3">{step.action}</div>}
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            <Card>
              <div className="flex items-center justify-between gap-2">
                <h2 className="display text-lg font-semibold">What the verifier signs</h2>
                <DataBadge kind="illustrative" />
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                Structure only. Angle-bracket values are placeholders, not real data.
              </p>
              <pre className="mono mt-3 overflow-x-auto rounded-2xl p-4 text-[11px] leading-relaxed" style={{ background: 'var(--surface-muted)' }}>
{`domain: {
  name: "ArcSLA", version: "1",
  chainId: ${CHAIN.chainId},
  verifyingContract: <ArcSLA address>
}
Fulfillment {
  agreementId  <uint256>
  specHash     <bytes32>
  provider     <address>
  evidenceHash <bytes32>
  expiry       <uint256>
}`}
              </pre>
            </Card>
            <Card>
              <h2 className="display text-lg font-semibold">Trust model</h2>
              <p className="mt-2 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
                The verifier decides whether the work was delivered. A valid signature proves the verifier approved it, not that the offchain service actually happened. If the verifier never signs, the customer is refunded after the deadline.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
