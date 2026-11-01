import type { Address, Hex } from 'viem'

export interface Agreement {
  id: bigint
  customer: Address
  provider: Address
  verifier: Address
  amount: bigint
  deadline: bigint
  specHash: Hex
  /** 0 = Active, 1 = Released, 2 = Refunded */
  status: number
  createdAt: bigint
  evidenceHash: Hex
}

export type EventKind = 'created' | 'released' | 'refunded'

/** A decoded ArcSLA log, flattened for display. Every field comes from a real log. */
export interface ArcEvent {
  kind: EventKind
  id: bigint
  amount: bigint
  /** Contract-recorded timestamp (createdAt / releasedAt / refundedAt). */
  at: bigint
  blockNumber: bigint
  logIndex: number
  txHash: Hex
  customer?: Address
  provider?: Address
  verifier?: Address
  submitter?: Address
  specHash?: Hex
  evidenceHash?: Hex
  deadline?: bigint
  attestationExpiry?: bigint
}
