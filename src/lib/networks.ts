import type { Address } from 'viem'

/**
 * Per-network ArcSLA deployments. PUBLIC data only (addresses and block numbers), kept in source so a
 * production build can never pick up the wrong contract from a stray environment variable.
 *
 * Each network has exactly one entry. A contract address belongs to one network and must never be reused
 * on another; `src/lib/env.ts` refuses any override that differs from the entry for the selected network.
 */
export type NetworkKey = 'testnet' | 'mainnet'

export interface NetworkDeployment {
  key: NetworkKey
  label: string
  chainId: number
  /** The deployed ArcSLA contract on this network. */
  arcsla: Address
  /** Block the contract was created in. Bounds the event scan. */
  deployBlock: bigint
}

export const NETWORKS: Readonly<Record<NetworkKey, NetworkDeployment>> = {
  testnet: {
    key: 'testnet',
    label: 'Arc Testnet',
    chainId: 5042002,
    // Deployed 2026-10-30 (tx 0xa94ee19a400f3c863362c0fbab49cf40abbef7772bb8d5a1c02210bd214df0c6).
    arcsla: '0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47',
    deployBlock: 69654812n,
  },
  mainnet: {
    key: 'mainnet',
    label: 'Arc Mainnet',
    chainId: 5042,
    // Deployed by the project owner (tx 0x25c9ec657b34e9c91a7c4a836b9b5352a0b0cfb7472071ca26da0289db1e7e66).
    arcsla: '0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC',
    deployBlock: 28741163n,
  },
}

export const NETWORK_STORAGE_KEY = 'arcsla.network'

export function isNetworkKey(value: unknown): value is NetworkKey {
  return value === 'testnet' || value === 'mainnet'
}

export type NetworkSource = 'url' | 'saved' | 'build-default' | 'legacy-chain-id' | 'fallback'

export interface NetworkSelectionInput {
  /** `?network=` in the page URL. */
  urlParam?: string | null
  /** The visitor's saved choice (localStorage). */
  saved?: string | null
  /** VITE_DEFAULT_NETWORK, set at build time. */
  buildDefault?: string
  /** VITE_ARC_CHAIN_ID (older configuration). */
  legacyChainId?: string
}

export interface NetworkSelection {
  key: NetworkKey
  source: NetworkSource
  /** Configuration problems found while resolving (these block every write). */
  issues: string[]
}

/**
 * Which network the app runs on. Order: explicit URL parameter, the visitor's saved choice, the build default,
 * the older VITE_ARC_CHAIN_ID, then Arc Testnet. Testnet is always the fallback.
 */
export function resolveNetwork(input: NetworkSelectionInput): NetworkSelection {
  const issues: string[] = []
  const buildDefault = input.buildDefault?.trim()
  const legacy = input.legacyChainId?.trim()

  if (isNetworkKey(input.urlParam)) return { key: input.urlParam, source: 'url', issues }
  if (isNetworkKey(input.saved)) return { key: input.saved, source: 'saved', issues }

  if (buildDefault) {
    if (isNetworkKey(buildDefault)) return { key: buildDefault, source: 'build-default', issues }
    issues.push(`VITE_DEFAULT_NETWORK "${buildDefault}" is not "testnet" or "mainnet", so the app fell back to Arc Testnet.`)
  }
  if (legacy) {
    const match = (Object.values(NETWORKS)).find((n) => String(n.chainId) === legacy)
    if (match) return { key: match.key, source: 'legacy-chain-id', issues }
    issues.push(`VITE_ARC_CHAIN_ID "${legacy}" is not a supported chain, so the app fell back to Arc Testnet.`)
  }
  return { key: 'testnet', source: 'fallback', issues }
}
