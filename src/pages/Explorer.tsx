import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useChainData } from '@/state/ChainData'
import { fmtDateTime, fmtUsdc, shortAddress, statusLabel } from '@/lib/format'
import { Link } from '@/lib/router'
import { CHAIN } from '@/lib/env'
import { ActivityList } from '@/components/ActivityList'
import { ScanStatus } from '@/components/ScanStatus'
import { Card, EmptyState, PageHeader, SetupRequired, Skeleton, StatusBadge } from '@/components/ui'

const FILTERS = ['All', 'Active', 'Released', 'Refunded'] as const

export default function Explorer() {
  const data = useChainData()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.agreements.filter((a) => {
      if (filter !== 'All' && statusLabel(a.status) !== filter) return false
      if (!q) return true
      return (
        a.id.toString() === q.replace('#', '') ||
        a.customer.toLowerCase().includes(q) ||
        a.provider.toLowerCase().includes(q) ||
        a.verifier.toLowerCase().includes(q) ||
        a.specHash.toLowerCase().includes(q)
      )
    })
  }, [data.agreements, filter, query])

  const settlements = useMemo(() => data.events.filter((e) => e.kind !== 'created'), [data.events])

  return (
    <>
      <PageHeader
        title="Public explorer"
        subtitle={`Every agreement and settlement on ${CHAIN.name}. Read-only: no wallet is needed.`}
      />

      {!data.configured ? (
        <SetupRequired />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
                <input className="input !pl-10" placeholder="Search ID, address or spec hash" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="scroll-x flex gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold"
                    style={{
                      background: filter === f ? 'var(--accent)' : 'var(--surface-strong)',
                      color: filter === f ? '#fff' : 'var(--ink)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              {data.loadingAgreements ? (
                <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
              ) : data.agreements.length === 0 ? (
                <EmptyState
                  title="No agreements yet"
                  body="The contract has no agreements. Create one to see it here."
                  action={<Link to="/create" className="btn btn-primary">Create agreement</Link>}
                />
              ) : rows.length === 0 ? (
                <EmptyState title="No matches" body="Try a different filter or search term." />
              ) : (
                <div className="-mx-2 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead>
                      <tr className="label">
                        <th className="px-2 py-2 font-semibold">ID</th>
                        <th className="px-2 py-2 font-semibold">Amount</th>
                        <th className="px-2 py-2 font-semibold">Customer</th>
                        <th className="px-2 py-2 font-semibold">Provider</th>
                        <th className="px-2 py-2 font-semibold">Deadline</th>
                        <th className="px-2 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id.toString()} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-2 py-3 font-semibold"><Link to={`/agreement/${a.id}`} className="hover:underline">#{a.id.toString()}</Link></td>
                          <td className="px-2 py-3 tabular-nums">{fmtUsdc(a.amount)}</td>
                          <td className="mono px-2 py-3 text-xs">{shortAddress(a.customer)}</td>
                          <td className="mono px-2 py-3 text-xs">{shortAddress(a.provider)}</td>
                          <td className="px-2 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(a.deadline)}</td>
                          <td className="px-2 py-3"><StatusBadge status={a.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {data.agreementCount !== undefined && BigInt(data.agreements.length) < data.agreementCount && (
              <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>Showing the {data.agreements.length} most recent of {data.agreementCount.toString()} agreements.</p>
            )}
          </Card>

          <Card>
            <h2 className="display text-xl font-semibold">Settlement events</h2>
            <div className="mt-1"><ScanStatus /></div>
            <div className="mt-2">
              {settlements.length === 0 ? (
                <EmptyState title="No settlements yet" body="Releases and refunds are listed here with links to their transactions." />
              ) : (
                <ActivityList events={settlements} limit={20} />
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
