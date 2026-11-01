import { isHex, type Address, type Hex } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID } from './env'

export const STATUS_LABELS = ['Active', 'Released', 'Refunded'] as const
export type StatusLabel = (typeof STATUS_LABELS)[number]

export function statusLabel(status: number): StatusLabel {
  return STATUS_LABELS[status] ?? 'Active'
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

export function sameAddress(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/** Exact USDC amount with thousands separators and at least two fraction digits. */
export function fmtUsdc(raw: bigint): string {
  const exact = formatUsdc(raw)
  const [whole, fraction = ''] = exact.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction.padEnd(2, '0')}`
}

export function fmtDateTime(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.abs(Math.floor(totalSeconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function fmtRelative(targetSeconds: number, nowSeconds: number): string {
  const diff = targetSeconds - nowSeconds
  const text = fmtDuration(diff)
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

export const txUrl = (hash: Hex) => buildTxExplorerUrl(CHAIN_ID, hash)
export const addressUrl = (address: Address) => buildAddressExplorerUrl(CHAIN_ID, address)

export function isBytes32(value: string): value is Hex {
  return isHex(value, { strict: true }) && value.length === 66
}

/** Pulls a readable revert name out of a viem error, or a short fallback. */
export function parseOnchainError(error: unknown): string {
  const err = error as { name?: string; message?: string; shortMessage?: string; code?: number; cause?: unknown }
  const message = (err?.shortMessage ?? err?.message ?? '').toLowerCase()
  if (err?.code === 4001 || message.includes('user rejected') || message.includes('user denied')) {
    return 'Request cancelled in wallet.'
  }
  const reverted = findRevertName(error)
  if (reverted) return REVERT_COPY[reverted] ?? `Contract rejected the call: ${reverted}`
  if (message.includes('insufficient funds')) return 'Insufficient balance for this transaction.'
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
    return 'Network issue. Check your connection and retry.'
  }
  return err?.shortMessage ?? 'Something went wrong. Please try again.'
}

export function findRevertName(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current; depth++) {
    const node = current as { data?: { errorName?: string }; errorName?: string; cause?: unknown; name?: string }
    if (node.data?.errorName) return node.data.errorName
    if (node.errorName) return node.errorName
    current = node.cause
  }
  return undefined
}

export const REVERT_COPY: Record<string, string> = {
  ZeroAddress: 'A required address was empty.',
  ZeroAmount: 'Amount must be greater than zero.',
  InvalidDeadline: 'The deadline must be in the future.',
  ZeroSpecHash: 'The specification hash cannot be empty.',
  InvalidParties: 'Customer, provider and verifier must be three distinct accounts.',
  AmountMismatch: 'The token did not deliver the exact amount.',
  AgreementNotFound: 'That agreement does not exist.',
  AgreementNotActive: 'This agreement is already settled.',
  DeadlinePassed: 'The release deadline has passed.',
  AttestationExpired: 'The attestation has expired.',
  SpecHashMismatch: 'The specification hash does not match the agreement.',
  ProviderMismatch: 'The provider does not match the agreement.',
  ZeroEvidenceHash: 'The evidence hash cannot be empty.',
  InvalidSigner: 'Signature rejected: it was not signed by this agreement’s verifier.',
  NotCustomer: 'Only the customer can claim this refund.',
  RefundNotAvailable: 'The deadline has not passed yet, so no refund is available.',
  ReentrancyGuardReentrantCall: 'Reentrant call blocked.',
  ECDSAInvalidSignature: 'Malformed signature.',
  ECDSAInvalidSignatureLength: 'Malformed signature length.',
}
