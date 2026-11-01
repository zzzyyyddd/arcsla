import type { ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from '@/lib/router'
import { CHAIN } from '@/lib/env'
import { NetworkBanner } from './NetworkBanner'
import { NetworkSwitcher } from './NetworkSwitcher'
import { useWalletGate } from '@/hooks/useTx'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/create', label: 'Create' },
  { to: '/explorer', label: 'Explorer' },
  { to: '/verifier', label: 'Verifier' },
  { to: '/refunds', label: 'Refunds' },
  { to: '/demo', label: 'Guided demo' },
]

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const gate = useWalletGate()

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'rgba(249,249,252,0.82)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="ArcSLA home">
            <span className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent)' }}>
              <ShieldCheck className="size-5 text-white" />
            </span>
            <span className="leading-tight">
              <span className="display block text-lg font-bold">ArcSLA</span>
              <span className="hidden text-[11px] sm:block" style={{ color: 'var(--subtle)' }}>
                Verifiable service settlement
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink key={item.to} {...item} active={isActive(pathname, item.to)} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block">
              <NetworkSwitcher />
            </span>
            <ConnectKitButton />
          </div>
        </div>
        <div className="px-4 pb-2 sm:hidden">
          <NetworkSwitcher />
        </div>
        <nav className="scroll-x flex gap-1 px-4 pb-2 lg:hidden" aria-label="Primary mobile">
          {NAV.map((item) => (
            <NavLink key={item.to} {...item} active={isActive(pathname, item.to)} />
          ))}
        </nav>
      </header>

      <NetworkBanner />

      {gate.wrongChain && (
        <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'rgba(154,98,0,0.09)', color: '#7a4e00' }}
            role="alert"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> Your wallet is on a different network. ArcSLA runs on {CHAIN.name}.
            </span>
            <button className="btn btn-ghost" onClick={gate.switchToApp} disabled={gate.switching}>
              Switch network
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-20 text-xs sm:px-6" style={{ color: 'var(--subtle)' }}>
        <p className="max-w-[70ch] text-pretty">
          The verifier is trusted to attest fulfillment. A valid EIP-712 signature proves the verifier signed; it does not prove the offchain service was
          delivered. ArcSLA has no owner, no fees and no upgrade path.
        </p>
      </footer>
    </div>
  )
}

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to)
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className="inline-flex min-h-10 shrink-0 items-center rounded-xl px-3.5 text-sm font-semibold transition-colors"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--ink-2)',
      }}
    >
      {label}
    </Link>
  )
}
