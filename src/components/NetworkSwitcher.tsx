import { NETWORKS, NETWORK_STORAGE_KEY, type NetworkKey } from '@/lib/networks'
import { NETWORK_KEY } from '@/lib/env'

/**
 * Network selector: Arc Testnet and Arc Mainnet are separate configurations. Choosing one saves the choice and
 * reloads the page, so every read, write, explorer link, event scan and wallet check restarts on the new network.
 * Switching to mainnet asks for confirmation first. Nothing here sends a transaction.
 */
export function NetworkSwitcher() {
  const choose = (key: NetworkKey) => {
    if (key === NETWORK_KEY) return
    if (
      key === 'mainnet' &&
      !window.confirm(
        'Switch to Arc Mainnet?\n\nMainnet uses real USDC and transactions cannot be undone. ArcSLA has not had an independent professional audit. Arc Testnet stays available at any time.',
      )
    ) {
      return
    }
    try {
      window.localStorage.setItem(NETWORK_STORAGE_KEY, key)
    } catch {
      /* storage blocked: fall back to the URL parameter below */
    }
    const url = new URL(window.location.href)
    url.searchParams.set('network', key)
    window.location.assign(url.toString())
  }

  return (
    <div
      role="group"
      aria-label="Network"
      className="inline-flex items-center rounded-full p-0.5 text-xs font-semibold"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      {(Object.keys(NETWORKS) as NetworkKey[]).map((key) => {
        const active = key === NETWORK_KEY
        const mainnet = key === 'mainnet'
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => choose(key)}
            className="min-h-8 rounded-full px-3 py-1 transition-colors"
            style={{
              background: active ? (mainnet ? 'var(--danger)' : 'var(--accent)') : 'transparent',
              color: active ? '#fff' : 'var(--ink-2)',
              cursor: active ? 'default' : 'pointer',
            }}
          >
            {mainnet ? 'Mainnet' : 'Testnet'}
          </button>
        )
      })}
    </div>
  )
}
