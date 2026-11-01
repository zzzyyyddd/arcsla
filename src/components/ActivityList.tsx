import { ArrowDownLeft, ArrowUpRight, FilePlus2 } from 'lucide-react'
import type { ArcEvent } from '@/lib/types'
import { fmtDateTime, fmtUsdc, shortAddress } from '@/lib/format'
import { Link } from '@/lib/router'
import { TxLink } from './ui'

const META = {
  created: { label: 'Agreement funded', icon: FilePlus2, color: '#1061a6', bg: 'rgba(16,97,166,0.1)' },
  released: { label: 'Released to provider', icon: ArrowUpRight, color: 'var(--success)', bg: 'rgba(26,128,71,0.12)' },
  refunded: { label: 'Refunded to customer', icon: ArrowDownLeft, color: 'var(--warn)', bg: 'rgba(154,98,0,0.12)' },
} as const

export function ActivityList({ events, limit }: { events: ArcEvent[]; limit?: number }) {
  const ordered = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1,
  )
  const shown = limit ? ordered.slice(0, limit) : ordered
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {shown.map((e) => {
        const meta = META[e.kind]
        const Icon = meta.icon
        const counterparty = e.kind === 'created' ? e.provider : e.kind === 'released' ? e.provider : e.customer
        return (
          <li key={`${e.txHash}:${e.logIndex}`} className="flex items-center gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: meta.bg }}>
              <Icon className="size-4" style={{ color: meta.color }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                <Link to={`/agreement/${e.id}`} className="hover:underline">
                  #{e.id.toString()}
                </Link>{' '}
                <span style={{ color: 'var(--ink-2)' }}>{meta.label}</span>
              </p>
              <p className="truncate text-xs" style={{ color: 'var(--subtle)' }}>
                {fmtDateTime(e.at)}
                {counterparty ? ` · ${e.kind === 'created' ? 'for' : 'to'} ${shortAddress(counterparty)}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="display text-sm font-bold tabular-nums">{fmtUsdc(e.amount)} USDC</p>
              <TxLink hash={e.txHash}>Tx</TxLink>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
