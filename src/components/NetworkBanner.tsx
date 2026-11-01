import { AlertOctagon, ShieldCheck } from 'lucide-react'
import { ARCSLA_ADDRESS, CHAIN, IS_MAINNET } from '@/lib/env'
import { shortAddress } from '@/lib/format'
import { useWriteGuard } from '@/state/NetworkGuard'
import { Notice } from './ui'

/** Real-funds warning (mainnet) and contract/config verification status (every network). */
export function NetworkBanner() {
  const guard = useWriteGuard()

  return (
    <div className="mx-auto mt-4 max-w-6xl space-y-3 px-4 sm:px-6">
      {IS_MAINNET && (
        <div
          role="alert"
          className="rounded-2xl p-4 sm:p-5"
          style={{ background: '#fff4f1', border: '2px solid var(--danger)', color: '#7d1d33' }}
        >
          <div className="flex items-start gap-3">
            <AlertOctagon className="mt-0.5 size-6 shrink-0" style={{ color: 'var(--danger)' }} />
            <div className="min-w-0">
              <p className="display text-lg font-bold">Arc Mainnet: real USDC, irreversible transactions</p>
              <p className="mt-1 max-w-[75ch] text-pretty text-sm">
                Every transaction here moves real funds and cannot be undone. ArcSLA has no admin, no pause and no recovery path, and it has not had an
                independent professional audit. The verifier is trusted to attest fulfillment; if it is dishonest or compromised, funds can be released for
                undelivered work. Use only an amount you can afford to lose.
              </p>
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={guard.acknowledged}
                  onChange={(e) => guard.setAcknowledged(e.target.checked)}
                />
                <span>I understand the risks and want to enable transactions on Arc Mainnet.</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {guard.configIssues.map((issue) => (
        <Notice key={issue} tone="error">
          <span className="font-semibold">Configuration problem.</span> {issue} Transactions are disabled.
        </Notice>
      ))}

      {guard.configIssues.length === 0 && ARCSLA_ADDRESS && (guard.contractStatus === 'missing' || guard.contractStatus === 'mismatch') && (
        <Notice tone="error">
          <span className="font-semibold">Contract check failed.</span> {guard.contractDetail} Transactions and signing are disabled until the configured address is
          corrected.
        </Notice>
      )}

      {guard.contractStatus === 'unreachable' && (
        <Notice tone="warn">
          Could not reach {CHAIN.name} to verify the ArcSLA contract, so transactions are disabled. Retrying automatically.
        </Notice>
      )}

      {guard.contractStatus === 'ok' && ARCSLA_ADDRESS && IS_MAINNET && (
        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
          <ShieldCheck className="size-3.5" style={{ color: 'var(--success)' }} />
          Verified onchain: ArcSLA at <span className="mono">{shortAddress(ARCSLA_ADDRESS)}</span> reports the expected USDC token and a signing domain bound to {CHAIN.name}.
        </p>
      )}
    </div>
  )
}
