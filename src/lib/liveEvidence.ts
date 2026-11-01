/**
 * Browser-side log of read-only simulations run during the live testnet runbook. A simulated
 * call leaves no onchain record, so the result is remembered here and shown as
 * "recorded in this browser". It never stands in for a transaction.
 */
export type SimKind =
  | 'wrongSigner'
  | 'tampered'
  | 'validAccepted'
  | 'earlyRefund'
  | 'duplicateRelease'
  | 'duplicateRefund'

export interface SimRecord {
  agreementId: string
  kind: SimKind
  /** Revert name from the contract, or "accepted" when the simulation succeeded. */
  outcome: string
  /** Chain-clock seconds when the simulation ran. */
  atChainTime: number
  /** Agreement deadline (seconds) known at that moment, for early-refund validity. */
  deadline?: number
}

const KEY = 'arcsla.liveSims.v1'

export function readSims(): SimRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SimRecord[]) : []
  } catch {
    return []
  }
}

export function recordSim(record: SimRecord) {
  try {
    const rest = readSims().filter((r) => !(r.agreementId === record.agreementId && r.kind === record.kind))
    localStorage.setItem(KEY, JSON.stringify([...rest, record]))
    window.dispatchEvent(new Event('arcsla-sims'))
  } catch {
    /* storage unavailable */
  }
}

export function findSim(sims: SimRecord[], agreementId: bigint, kind: SimKind): SimRecord | undefined {
  return sims.find((r) => r.agreementId === agreementId.toString() && r.kind === kind)
}
