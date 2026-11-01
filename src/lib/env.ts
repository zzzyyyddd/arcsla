/**
 * Runtime configuration. Every deployment-specific value comes from Vite env
 * (`VITE_*`, public values only) or from the generated `@/onchain-facts`
 * registry. Nothing here is a guessed address.
 *
 * Two separate networks, one app. The network is chosen when the page loads:
 *   1. ?network=testnet|mainnet in the URL (remembered),
 *   2. the visitor's saved choice from the network selector,
 *   3. VITE_DEFAULT_NETWORK, set when the site is built,
 *   4. the older VITE_ARC_CHAIN_ID,
 *   5. Arc Testnet.
 * Contract addresses and deployment blocks come from src/lib/networks.ts, one entry per network, so
 * the testnet contract can never be used on mainnet or the reverse. Chain ID, RPC, explorer, USDC,
 * event scans and wallet checks all derive from the selected network.
 */
import { isAddress, type Address } from 'viem'
import { getUsdc, requireChain } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { NETWORKS, NETWORK_STORAGE_KEY, resolveNetwork } from './networks'

type Browser = { location?: { search?: string }; localStorage?: Storage }
const browser = globalThis as unknown as Browser

function readUrlNetwork(): string | null {
  try {
    return new URLSearchParams(browser.location?.search ?? '').get('network')
  } catch {
    return null
  }
}
function readSavedNetwork(): string | null {
  try {
    return browser.localStorage?.getItem(NETWORK_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function readAddress(raw: string | undefined): Address | undefined {
  const value = raw?.trim()
  return value && isAddress(value) ? value : undefined
}

const rawChainId = (import.meta.env.VITE_ARC_CHAIN_ID as string | undefined)?.trim()

const selection = resolveNetwork({
  urlParam: readUrlNetwork(),
  saved: readSavedNetwork(),
  buildDefault: import.meta.env.VITE_DEFAULT_NETWORK as string | undefined,
  legacyChainId: rawChainId,
})
// An explicit ?network= choice is remembered, so it survives in-app navigation and reloads.
if (selection.source === 'url') {
  try {
    browser.localStorage?.setItem(NETWORK_STORAGE_KEY, selection.key)
  } catch {
    /* storage unavailable: the choice simply is not remembered */
  }
}

/** The selected network ("testnet" or "mainnet"). Everything below derives from it. */
export const NETWORK_KEY = selection.key
export const NETWORK_SOURCE = selection.source
const deployment = NETWORKS[NETWORK_KEY]

export const CHAIN_ID = deployment.chainId
export const CHAIN = requireChain(CHAIN_ID)

/** The registered ArcSLA contract for the SELECTED network (src/lib/networks.ts). */
export const ARCSLA_ADDRESS: Address | undefined = deployment.arcsla

/** Block the registered contract was created in. Bounds the event scan. */
export const DEPLOY_BLOCK: bigint | undefined = deployment.deployBlock

const registryUsdc = readAddress(getUsdc(CHAIN_ID)?.address)
const usdcOverride = readAddress(import.meta.env.VITE_USDC_ADDRESS as string | undefined)

/**
 * USDC (ERC-20 view, 6 decimals). Defaults to the address in the generated
 * registry for the selected chain; `VITE_USDC_ADDRESS` overrides it (and is
 * reported as a configuration problem when it differs).
 */
export const USDC_ADDRESS: Address | undefined = usdcOverride ?? registryUsdc

export const IS_TESTNET = CHAIN.isTestnet
export const IS_MAINNET = !CHAIN.isTestnet

/**
 * Optional proof-of-concept safety rails (UI only; the contract has no limits). Set in
 * .env.mainnet, e.g. VITE_MAX_AGREEMENT_USDC=0.01 and VITE_MAX_DEADLINE_HOURS=2.
 */
const rawMaxAmount = (import.meta.env.VITE_MAX_AGREEMENT_USDC as string | undefined)?.trim()
const rawMaxHours = (import.meta.env.VITE_MAX_DEADLINE_HOURS as string | undefined)?.trim()
function readMaxAmount(): bigint | undefined {
  if (!rawMaxAmount) return undefined
  try {
    const parsed = parseUsdc(rawMaxAmount)
    return parsed > 0n ? parsed : undefined
  } catch {
    return undefined
  }
}
function readMaxDeadline(): number | undefined {
  if (!rawMaxHours) return undefined
  const hours = Number(rawMaxHours)
  return Number.isFinite(hours) && hours > 0 ? Math.floor(hours * 3600) : undefined
}
/** Largest agreement the UI will create, in 6-decimal USDC units. Applies on mainnet only. */
export const MAX_AGREEMENT_RAW = IS_MAINNET ? readMaxAmount() : undefined
/** Longest deadline (seconds from now) the UI will create. Applies on mainnet only. */
export const MAX_DEADLINE_SECONDS = IS_MAINNET ? readMaxDeadline() : undefined

/**
 * Static configuration problems that must block every write. Checked without any
 * network call, so a bad .env can never reach a wallet prompt.
 */
export const CONFIG_ISSUES: string[] = (() => {
  const issues: string[] = [...selection.issues]
  const other = NETWORKS[NETWORK_KEY === 'mainnet' ? 'testnet' : 'mainnet']
  if (deployment.arcsla.toLowerCase() === other.arcsla.toLowerCase()) {
    issues.push('The registered ArcSLA addresses for Arc Testnet and Arc Mainnet are identical. A contract address is network-specific.')
  }
  if (!USDC_ADDRESS) {
    issues.push(`No USDC address is known for ${CHAIN.name}.`)
  }
  // Older single-network variables may still be present in .env. They are accepted only when they agree with the
  // registered deployment for the selected network, so a stray value can never point a network at the wrong contract.
  const addressOverride = readAddress(import.meta.env.VITE_ARCSLA_ADDRESS as string | undefined)
  const overrideApplies = !rawChainId || Number(rawChainId) === CHAIN_ID
  if (addressOverride && overrideApplies && addressOverride.toLowerCase() !== deployment.arcsla.toLowerCase()) {
    issues.push(
      `VITE_ARCSLA_ADDRESS (${addressOverride}) differs from the registered ${deployment.label} deployment (${deployment.arcsla}). Remove it, or update src/lib/networks.ts after reviewing the new deployment.`,
    )
  }
  if (rawMaxAmount && readMaxAmount() === undefined) {
    issues.push(`VITE_MAX_AGREEMENT_USDC "${rawMaxAmount}" is not a valid USDC amount.`)
  }
  if (rawMaxHours && readMaxDeadline() === undefined) {
    issues.push(`VITE_MAX_DEADLINE_HOURS "${rawMaxHours}" is not a valid number of hours.`)
  }
  if (usdcOverride && registryUsdc && usdcOverride.toLowerCase() !== registryUsdc.toLowerCase()) {
    issues.push(
      IS_MAINNET
        ? 'VITE_USDC_ADDRESS differs from the official USDC address for this network. Remove it.'
        : 'VITE_USDC_ADDRESS differs from the registry USDC address for this network.',
    )
  }
  return issues
})()
