import type { Address, Hex } from 'viem'
import { ARCSLA_ADDRESS, CHAIN_ID } from './env'
import { ATTESTATION_DOMAIN_NAME, ATTESTATION_DOMAIN_VERSION } from './fulfillment-types'

export { FULFILLMENT_TYPES } from './fulfillment-types'

export function attestationDomain() {
  if (!ARCSLA_ADDRESS) throw new Error('ArcSLA address is not configured')
  return {
    name: ATTESTATION_DOMAIN_NAME,
    version: ATTESTATION_DOMAIN_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: ARCSLA_ADDRESS,
  } as const
}

export interface AttestationMessage {
  agreementId: bigint
  specHash: Hex
  provider: Address
  evidenceHash: Hex
  expiry: bigint
}

/** Flips one nibble in the signature's r value so it can never verify. */
export function corruptSignature(signature: Hex): Hex {
  const index = 12
  const current = signature[index]
  const replacement = current === 'a' ? 'b' : 'a'
  return `${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}` as Hex
}

export interface RejectionRecord {
  /** Revert name the contract answered with, e.g. InvalidSigner. */
  outcome: string
  /** ISO time the result was observed in this browser. */
  at: string
  /** Where it was observed: the one-click Guided Demo test or the verifier console. */
  via: 'demo' | 'verifier'
  agreementId?: string
  releaseTx?: Hex
}

// One key per network, so a result seen on Arc Testnet is never shown as completed on Arc Mainnet.
const rejectionKey = () => `arcsla.rejectionTested.${CHAIN_ID}`

/** Browser-local note that a rejection was observed. It is NOT an onchain record. */
export function markRejectionTested(errorName: string, details: Partial<Omit<RejectionRecord, 'outcome' | 'at'>> = {}) {
  const record: RejectionRecord = { outcome: errorName, at: new Date().toISOString(), via: 'verifier', ...details }
  try {
    localStorage.setItem(rejectionKey(), JSON.stringify(record))
  } catch {
    /* storage unavailable */
  }
}

export function readRejectionTested(): RejectionRecord | null {
  try {
    const raw = localStorage.getItem(rejectionKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RejectionRecord>
    return typeof parsed.outcome === 'string' && typeof parsed.at === 'string' ? (parsed as RejectionRecord) : null
  } catch {
    return null
  }
}
