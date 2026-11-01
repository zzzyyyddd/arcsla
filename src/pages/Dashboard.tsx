import { useMemo } from 'react'
import { ArrowRight, Lock } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useChainData } from '@/state/ChainData'
import { fmtUsdc } from '@/lib/format'
import { Link } from '@/lib/router'
import { CHAIN } from '@/lib/env'
import { ActivityList } from '@/components/ActivityList'
import { ScanStatus } from '@/components/ScanStatus'
import { Card, EmptyState, PageHeader, SetupRequired, Skeleton } from '@/components/ui'

export default function Dashboard() {
  const data = useChainData()

  const totals = useMemo(() => {
    let active = 0n
    let released = 0n
    let refunded = 0n
    let activeCount = 0
    for (const a of data.agreements) {
      if (a.status === 0) {
        active += a.amount
        activeCount++
      } else if (a.status === 1) released += a.amount
      else refunded += a.amount
    }
    return { active, released, refunded, activeCount }
  }, [data.agreements])

  if (!data.configured) {
    return (
      <>
        <PageHeader title="Settlement dashboard" subtitle="Live totals read directly from the ArcSLA contract." />
        <SetupRequired />
      </>
    )
  }

  const loading = data.loadingAgreements
  const escrow = data.totalEscrowed ?? totals.active
  const truncated = data.agreementCount !== undefined && BigInt(data.agreements.length) < data.agreementCount

  return (
    <>
      <PageHeader
        title="Settlement dashboard"
        subtitle={`Live totals read directly from the ArcSLA contract on ${CHAIN.name}.`}
        action={
          <Link to="/create" className="btn btn-primary">
            New agreement <ArrowRight className="size-4" />
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md" style={{ background: 'rgba(16,97,166,0.1)' }}>
              <Lock className="size-3.5" style={{ color: '#1061a6' }} />
            </span>
            <span className="label">Active escrow</span>
          </div>
          {loading ? (
            <Skeleton className="h-12 w-56" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="display text-5xl font-bold tabular-nums sm:text-6xl">{fmtUsdc(escrow)}</span>
              <span className="flex items-center gap-1.5 text-lg font-medium" style={{ color: 'var(--subtle)' }}>
                <TokenUSDC variant="branded" size={20} /> USDC
              </span>
            </div>
          )}
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            {totals.activeCount} active agreement{totals.activeCount === 1 ? '' : 's'} · held by the contract, releasable only with a verifier signature or refundable to the customer after the deadline.
          </p>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Stat label="Total agreements" value={data.agreementCount !== undefined ? data.agreementCount.toString() : undefined} loading={loading} />
          <Stat label="Released" value={`${fmtUsdc(totals.released)}`} unit="USDC" loading={loading} tone="success" />
          <Stat label="Refunded" value={`${fmtUsdc(totals.refunded)}`} unit="USDC" loading={loading} tone="warn" />
          <Stat label="Active" value={totals.activeCount.toString()} loading={loading} />
        </div>
      </div>

      {truncated && (
        <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
          Released and refunded totals cover the {data.agreements.length} most recent agreements. Active escrow is read from the contract directly.
        </p>
      )}
      {data.agreementsError && <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{data.agreementsError}</p>}

      <Card className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-xl font-semibold">Recent activity</h2>
          <ScanStatus />
        </div>
        {data.events.length === 0 ? (
          <EmptyState
            title={data.scan.status === 'scanning' ? 'Reading contract events…' : 'No activity yet'}
            body="Funding, release and refund events appear here as soon as they are confirmed onchain."
            action={
              <Link to="/create" className="btn btn-ghost">
                Create the first agreement
              </Link>
            }
          />
        ) : (
          <ActivityList events={data.events} limit={8} />
        )}
      </Card>
    </>
  )
}

function Stat({
  label,
  value,
  unit,
  loading,
  tone,
}: {
  label: string
  value?: string
  unit?: string
  loading: boolean
  tone?: 'success' | 'warn'
}) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)'
  return (
    <Card className="!p-4">
      <p className="label">{label}</p>
      {loading || value === undefined ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1.5 flex items-baseline gap-1">
          <span className="display text-2xl font-bold tabular-nums" style={{ color }}>
            {value}
          </span>
          {unit && <span className="text-xs" style={{ color: 'var(--subtle)' }}>{unit}</span>}
        </p>
      )}
    </Card>
  )
}
