import { useMemo } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { Clock, FileCheck2, FilePlus2, Undo2 } from 'lucide-react'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { ARCSLA_ADDRESS, CHAIN_ID } from '@/lib/env'
import { findRevertName, fmtDateTime, fmtDuration, fmtUsdc, sameAddress } from '@/lib/format'
import { Link } from '@/lib/router'
import type { Agreement, ArcEvent } from '@/lib/types'
import { useChainData } from '@/state/ChainData'
import { RefundButton } from '@/components/RefundButton'
import { ScanStatus } from '@/components/ScanStatus'
import { SimulationCard } from '@/components/SimulationCard'
import { AddressChip, Card, DataBadge, EmptyState, HashChip, PageHeader, Row, SetupRequired, Skeleton, StatusBadge, TxLink } from '@/components/ui'

const ZERO_HASH = `0x${'0'.repeat(64)}`

export default function AgreementDetail({ id: idText }: { id: string }) {
  const data = useChainData()
  const { address } = useAccount()

  const id = /^\d+$/.test(idText) ? BigInt(idText) : undefined

  const query = useReadContract({
    address: ARCSLA_ADDRESS,
    abi: arcSlaAbi,
    functionName: 'getAgreement',
    args: id !== undefined ? [id] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!ARCSLA_ADDRESS && id !== undefined, refetchInterval: 10_000, retry: false },
  })

  const agreement: Agreement | undefined = useMemo(
    () => (query.data && id !== undefined ? ({ id, ...query.data }) : undefined),
    [query.data, id],
  )

  const events = useMemo(
    () =>
      data.events
        .filter((e) => id !== undefined && e.id === id)
        .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1)),
    [data.events, id],
  )

  if (!ARCSLA_ADDRESS) {
    return (
      <>
        <PageHeader title="Agreement" />
        <SetupRequired />
      </>
    )
  }

  if (id === undefined || (query.error && findRevertName(query.error) === 'AgreementNotFound')) {
    return (
      <>
        <PageHeader title="Agreement not found" />
        <EmptyState
          title="No such agreement"
          body="That ID does not exist on the contract."
          action={<Link to="/explorer" className="btn btn-ghost">Browse all agreements</Link>}
        />
      </>
    )
  }

  if (!agreement) {
    return (
      <>
        <PageHeader title={`Agreement #${idText}`} />
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
          {query.error && <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>Could not read this agreement from the network.</p>}
        </Card>
      </>
    )
  }

  const deadline = Number(agreement.deadline)
  const expired = data.now > deadline
  const active = agreement.status === 0
  const isCustomer = sameAddress(address, agreement.customer)
  const isVerifier = sameAddress(address, agreement.verifier)
  const refundable = active && expired

  return (
    <>
      <PageHeader
        title={`Agreement #${agreement.id.toString()}`}
        subtitle="Terms and settlement record, read live from the contract."
        action={<StatusBadge status={agreement.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-baseline gap-2">
              <span className="display text-5xl font-bold tabular-nums">{fmtUsdc(agreement.amount)}</span>
              <span className="text-lg" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
              <Clock className="size-4" />
              {active
                ? expired
                  ? `Deadline passed ${fmtDuration(data.now - deadline)} ago. Release is closed; the customer can claim a refund.`
                  : `Release window closes in ${fmtDuration(deadline - data.now)} (${fmtDateTime(agreement.deadline)}).`
                : agreement.status === 1
                  ? 'Released to the provider.'
                  : 'Refunded to the customer.'}
            </p>

            <div className="mt-4">
              <Row label="Customer"><AddressChip address={agreement.customer} /></Row>
              <Row label="Provider"><AddressChip address={agreement.provider} /></Row>
              <Row label="Verifier"><AddressChip address={agreement.verifier} /></Row>
              <Row label="Deadline">{fmtDateTime(agreement.deadline)}</Row>
              <Row label="Created">{fmtDateTime(agreement.createdAt)}</Row>
              <Row label="Specification hash"><HashChip hash={agreement.specHash} /></Row>
              <Row label="Evidence hash">
                {agreement.evidenceHash === ZERO_HASH ? (
                  <span style={{ color: 'var(--subtle)' }}>Not attested</span>
                ) : (
                  <HashChip hash={agreement.evidenceHash} />
                )}
              </Row>
            </div>
          </Card>

          {(active || isCustomer || isVerifier) && (
            <Card>
              <h2 className="display text-xl font-semibold">Actions</h2>
              <div className="mt-3 space-y-4">
                {active && !expired && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-[46ch] text-sm" style={{ color: 'var(--muted)' }}>
                      {isVerifier
                        ? 'You are the verifier. Sign the fulfillment attestation once the service is delivered.'
                        : 'Anyone can submit the verifier’s signed attestation to settle this agreement.'}
                    </p>
                    <Link to={`/verifier?id=${agreement.id}`} className={`btn ${isVerifier ? 'btn-primary' : 'btn-ghost'}`}>
                      Open verifier console
                    </Link>
                  </div>
                )}
                {refundable && isCustomer && <RefundButton id={agreement.id} />}
                {refundable && !isCustomer && (
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    This agreement is expired and unsettled. Only the customer wallet can claim the refund.
                  </p>
                )}
              </div>
            </Card>
          )}

          <SimulationCard agreement={agreement} />
        </div>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="display text-xl font-semibold">Timeline</h2>
            <DataBadge kind="onchain" />
          </div>
          <div className="mt-1"><ScanStatus /></div>
          <Timeline agreement={agreement} events={events} />
        </Card>
      </div>
    </>
  )
}

function Timeline({ agreement, events }: { agreement: Agreement; events: ArcEvent[] }) {
  const hasCreated = events.some((e) => e.kind === 'created')
  const items: { key: string; icon: typeof FilePlus2; title: string; detail: string; at: bigint; tx?: ArcEvent['txHash']; tone: string }[] = []

  for (const e of events) {
    if (e.kind === 'created') {
      items.push({ key: `${e.txHash}:${e.logIndex}`, icon: FilePlus2, title: 'Funded and created', detail: `${fmtUsdc(e.amount)} USDC moved into escrow`, at: e.at, tx: e.txHash, tone: '#1061a6' })
    } else if (e.kind === 'released') {
      items.push({ key: `${e.txHash}:${e.logIndex}`, icon: FileCheck2, title: 'Verified and released', detail: `Attestation submitted by ${e.submitter?.slice(0, 8) ?? 'unknown'}…`, at: e.at, tx: e.txHash, tone: 'var(--success)' })
    } else {
      items.push({ key: `${e.txHash}:${e.logIndex}`, icon: Undo2, title: 'Refunded to customer', detail: `${fmtUsdc(e.amount)} USDC returned after the deadline`, at: e.at, tx: e.txHash, tone: 'var(--warn)' })
    }
  }
  if (!hasCreated) {
    items.unshift({ key: 'created-state', icon: FilePlus2, title: 'Created', detail: 'From contract state. The creation log is outside the scanned block range.', at: agreement.createdAt, tone: '#1061a6' })
  }

  if (items.length === 0) return <EmptyState title="No events" body="Nothing recorded yet." />

  return (
    <ol className="mt-4 space-y-5">
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <li key={item.key} className="relative flex gap-3">
            {index < items.length - 1 && <span className="absolute left-5 top-11 h-[calc(100%-1rem)] w-px" style={{ background: 'var(--border)' }} />}
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)' }}>
              <Icon className="size-4" style={{ color: item.tone }} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{item.detail}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>{fmtDateTime(item.at)}</p>
              {item.tx && <div className="mt-1"><TxLink hash={item.tx} /></div>}
            </div>
          </li>
        )
      })}
      {agreement.status === 0 && (
        <li className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)' }}>
            <Clock className="size-4" style={{ color: 'var(--subtle)' }} />
          </span>
          <div>
            <p className="text-sm font-semibold">Awaiting settlement</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Release with a verifier signature, or refund after the deadline.</p>
          </div>
        </li>
      )}
    </ol>
  )
}
