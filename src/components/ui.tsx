import { useState, type ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Loader2, Settings2 } from 'lucide-react'
import type { Address, Hex } from 'viem'
import { useWalletGate } from '@/hooks/useTx'
import { useWriteGuard } from '@/state/NetworkGuard'
import { CHAIN } from '@/lib/env'
import { addressUrl, shortAddress, shortHash, statusLabel, txUrl } from '@/lib/format'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display text-balance text-3xl font-bold sm:text-4xl" style={{ color: 'var(--ink)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-[60ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 sm:p-6 ${className}`}>{children}</section>
}

const STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  Active: { bg: 'rgba(16,97,166,0.1)', fg: '#1061a6' },
  Released: { bg: 'rgba(26,128,71,0.12)', fg: 'var(--success)' },
  Refunded: { bg: 'rgba(154,98,0,0.12)', fg: 'var(--warn)' },
}

export function StatusBadge({ status }: { status: number }) {
  const label = statusLabel(status)
  const style = STATUS_STYLES[label]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  )
}

export function DataBadge({ kind }: { kind: 'onchain' | 'illustrative' }) {
  const onchain = kind === 'onchain'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: onchain ? 'rgba(26,128,71,0.12)' : 'rgba(154,98,0,0.12)',
        color: onchain ? 'var(--success)' : 'var(--warn)',
      }}
    >
      {onchain ? 'Onchain data' : 'Illustrative example'}
    </span>
  )
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }
  return { copied, copy }
}

export function AddressChip({ address, label }: { address: Address; label?: string }) {
  const { copied, copy } = useCopy(address)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>}
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="mono text-xs underline-offset-2 hover:underline"
        style={{ color: 'var(--ink-2)' }}
        title={address}
      >
        {shortAddress(address)}
      </a>
      <button
        onClick={() => void copy()}
        aria-label="Copy address"
        className="inline-flex size-6 items-center justify-center rounded-md hover:bg-black/5"
      >
        {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" style={{ color: 'var(--subtle)' }} />}
      </button>
    </span>
  )
}

export function HashChip({ hash, full = false }: { hash: Hex; full?: boolean }) {
  const { copied, copy } = useCopy(hash)
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="mono break-all text-xs" style={{ color: 'var(--ink-2)' }} title={hash}>
        {full ? hash : shortHash(hash)}
      </span>
      <button
        onClick={() => void copy()}
        aria-label="Copy hash"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
      >
        {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" style={{ color: 'var(--subtle)' }} />}
      </button>
    </span>
  )
}

export function TxLink({ hash, children }: { hash: Hex; children?: ReactNode }) {
  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
      style={{ color: 'var(--accent-hover)' }}
    >
      {children ?? 'View transaction'} <ExternalLink className="size-3" />
    </a>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6" style={{ borderTop: '1px solid var(--border)' }}>
      <span className="label shrink-0">{label}</span>
      <div className="min-w-0 text-sm sm:text-right" style={{ color: 'var(--ink)' }}>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="inner flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="display text-lg font-semibold">{title}</p>
      <p className="max-w-[46ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl ${className}`} style={{ background: 'rgba(18,45,69,0.07)' }} />
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const palette = {
    info: { bg: 'rgba(16,97,166,0.07)', fg: '#0d4d84', icon: <Settings2 className="size-4 shrink-0" /> },
    warn: { bg: 'rgba(154,98,0,0.09)', fg: '#7a4e00', icon: <AlertTriangle className="size-4 shrink-0" /> },
    error: { bg: 'rgba(186,43,76,0.08)', fg: 'var(--danger)', icon: <AlertTriangle className="size-4 shrink-0" /> },
    success: { bg: 'rgba(26,128,71,0.09)', fg: 'var(--success)', icon: <CheckCircle2 className="size-4 shrink-0" /> },
  }[tone]
  return (
    <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm" style={{ background: palette.bg, color: palette.fg }} role={tone === 'error' ? 'alert' : undefined}>
      <span className="mt-0.5">{palette.icon}</span>
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

/** Primary transaction button: handles connect, wrong network, pending and confirming. */
export function TxButton({
  label,
  onClick,
  disabled,
  pending,
  confirming,
  variant = 'primary',
  className = '',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pending?: boolean
  confirming?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  className?: string
}) {
  const gate = useWalletGate()
  const guard = useWriteGuard()
  const cls = `btn ${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost'} ${className}`

  if (!gate.isConnected) {
    return (
      <ConnectKitButton.Custom>
        {({ show }) => (
          <button className={cls} onClick={show}>
            Connect wallet
          </button>
        )}
      </ConnectKitButton.Custom>
    )
  }
  if (gate.wrongChain) {
    return (
      <button className={cls} onClick={gate.switchToApp} disabled={gate.switching}>
        {gate.switching ? <Loader2 className="size-4 animate-spin" /> : null}
        Switch to {CHAIN.name}
      </button>
    )
  }
  if (guard.blockedReason) {
    return (
      <div className={className.includes('w-full') ? 'w-full' : ''}>
        <button className={cls} disabled title={guard.blockedReason}>
          {guard.contractStatus === 'checking' ? 'Verifying contract…' : 'Transactions disabled'}
        </button>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>{guard.blockedReason}</p>
      </div>
    )
  }
  return (
    <button className={cls} onClick={onClick} disabled={disabled || pending || confirming}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Confirm in wallet…
        </>
      ) : confirming ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Confirming…
        </>
      ) : (
        label
      )}
    </button>
  )
}

export function SetupRequired() {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(16,97,166,0.1)' }}>
          <Settings2 className="size-5" style={{ color: 'var(--accent-hover)' }} />
        </div>
        <div className="min-w-0">
          <h2 className="display text-xl font-semibold">Contract address required</h2>
          <p className="mt-1 max-w-[62ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            No ArcSLA contract is registered for {CHAIN.name}. Nothing on this site is mocked, so every page waits for a real deployment.
          </p>
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm" style={{ color: 'var(--ink-2)' }}>
            <li>Deploy <span className="mono text-xs">contracts/ArcSLA.sol</span> with the USDC token address as its only constructor argument.</li>
            <li>
              Add its address and deployment block to <span className="mono text-xs">src/lib/networks.ts</span> for this network, one entry per network.
            </li>
            <li>Reload the app.</li>
          </ol>
        </div>
      </div>
    </Card>
  )
}

export function Spinner() {
  return <Loader2 className="size-4 animate-spin" />
}
