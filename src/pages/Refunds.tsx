import { useMemo } from 'react'
import { useAccount } from 'wagmi'
import { fmtDateTime, fmtDuration, fmtUsdc, sameAddress } from '@/lib/format'
import { Link } from '@/lib/router'
import type { Agreement } from '@/lib/types'
import { useChainData } from '@/state/ChainData'
import { RefundButton } from '@/components/RefundButton'
import { AddressChip, Card, EmptyState, PageHeader, SetupRequired, Skeleton } from '@/components/ui'

export default function Refunds() {
  const data = useChainData()
  const { address } = useAccount()

  const { expired, mineUpcoming } = useMemo(() => {
    const active = data.agreements.filter((a) => a.status === 0)
    return {
      expired: active.filter((a) => data.now > Number(a.deadline)),
      mineUpcoming: active.filter((a) => data.now <= Number(a.deadline) && sameAddress(a.customer, address)),
    }
  }, [data.agreements, data.now, address])

  if (!data.configured) {
    return (
      <>
        <PageHeader title="Refund console" />
        <SetupRequired />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Refund console"
        subtitle="Agreements past their deadline that were never released. Only the customer wallet can claim the refund, and the full escrowed amount is returned."
      />

      <Card>
        <h2 className="display text-xl font-semibold">Expired and unsettled</h2>
        <div className="mt-3">
          {data.loadingAgreements ? (
            <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : expired.length === 0 ? (
            <EmptyState title="Nothing to refund" body="No active agreement has passed its deadline. When one does, it appears here and the customer can claim it." />
          ) : (
            <ul className="space-y-3">
              {expired.map((a) => (
                <RefundRow key={a.id.toString()} agreement={a} now={data.now} mine={sameAddress(a.customer, address)} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {address && (
        <Card className="mt-4">
          <h2 className="display text-xl font-semibold">Your agreements approaching their deadline</h2>
          <div className="mt-3">
            {mineUpcoming.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>You have no active agreements still inside their release window.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {mineUpcoming.map((a) => (
                  <li key={a.id.toString()} className="flex flex-wrap items-center justify-between gap-2 py-3" style={{ borderColor: 'var(--border)' }}>
                    <Link to={`/agreement/${a.id}`} className="text-sm font-semibold hover:underline">#{a.id.toString()} · {fmtUsdc(a.amount)} USDC</Link>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>Refundable in {fmtDuration(Number(a.deadline) - data.now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </>
  )
}

function RefundRow({ agreement, now, mine }: { agreement: Agreement; now: number; mine: boolean }) {
  return (
    <li className="inner flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">
          <Link to={`/agreement/${agreement.id}`} className="hover:underline">Agreement #{agreement.id.toString()}</Link>
          <span className="ml-2 display text-base font-bold tabular-nums">{fmtUsdc(agreement.amount)} USDC</span>
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Expired {fmtDateTime(agreement.deadline)} · {fmtDuration(now - Number(agreement.deadline))} ago
        </p>
        <AddressChip address={agreement.customer} label="Customer" />
      </div>
      {mine ? (
        <div className="w-full sm:w-auto sm:min-w-52"><RefundButton id={agreement.id} /></div>
      ) : (
        <span className="text-xs" style={{ color: 'var(--subtle)' }}>Only the customer can claim</span>
      )}
    </li>
  )
}
