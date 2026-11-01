/**
 * Read-only "invalid signature is rejected" demonstration.
 *
 * It takes the ORIGINAL, already-onchain EIP-712 attestation of a released agreement (decoded from the
 * release transaction's calldata), changes one byte of its signature, and asks the deployed contract's own
 * verification (an eth_call, never a transaction) whether it would accept it.
 *
 * A released agreement is no longer Active, and the contract checks the status BEFORE the signature, so on the
 * real state every attempt just answers AgreementNotActive. To reach the signature check the node is asked to
 * evaluate the call against a temporary, hypothetical copy of the agreement in the Active state (an RPC state
 * override) at the time the original release happened. That copy exists only inside that one eth_call: nothing is
 * sent, no wallet prompt appears, no USDC moves, and the real agreement is not changed. This module never
 * fabricates a result: any step that cannot be completed is reported as unavailable.
 */
import {
  decodeErrorResult,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBigInt,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { ATTESTATION_DOMAIN_NAME, ATTESTATION_DOMAIN_VERSION, FULFILLMENT_TYPES } from './fulfillment-types'
import type { Agreement } from './types'

export interface DemoContext {
  client: PublicClient
  arcsla: Address
  chainId: number
}

export interface OriginalAttestation {
  agreementId: bigint
  specHash: Hex
  provider: Address
  evidenceHash: Hex
  expiry: bigint
  signature: Hex
  txHash: Hex
  /** Signer recovered locally from the signature with the EIP-712 domain of this contract. */
  recoveredSigner: Address
}

export type LoadResult = { ok: true; attestation: OriginalAttestation } | { ok: false; reason: string }

export type Outcome = { kind: 'accepted' } | { kind: 'rejected'; name: string }

export interface RejectionResult {
  /** The original signature against the real, settled agreement. Not a signature test. */
  realState: Outcome
  /** Simulation check that the temporary Active copy matches the real agreement apart from its status. */
  copyMatchesAgreement: boolean
  /** Original signature against the temporary Active copy (control). */
  control: Outcome
  /** The same signature with one byte changed, against the same copy. */
  tampered: Outcome
  tamperedByte: { index: number; before: string; after: string }
  /** Chain time the simulation ran at (the original release time). */
  simulatedAt: bigint
  /** True only when the control was accepted AND the tampered signature was rejected with InvalidSigner. */
  rejected: boolean
}

export const UNAVAILABLE_TITLE = 'Test unavailable: original signature required'

/** Reads the revert reason name from whatever error viem threw. */
export function revertName(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 10 && current; depth++) {
    const node = current as { data?: unknown; errorName?: unknown; cause?: unknown }
    if (typeof node.errorName === 'string') return node.errorName
    if (node.data && typeof node.data === 'object' && typeof (node.data as { errorName?: unknown }).errorName === 'string') {
      return (node.data as { errorName: string }).errorName
    }
    if (typeof node.data === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(node.data)) {
      try {
        return decodeErrorResult({ abi: arcSlaAbi, data: node.data as Hex }).errorName
      } catch {
        /* not an ArcSLA error: keep walking */
      }
    }
    current = node.cause
  }
  return 'reverted (reason not decoded)'
}

/** Flips the lowest bit of one byte of a 65-byte signature. Default byte 4 sits inside r. */
export function tamperOneByte(signature: Hex, index = 4): { tampered: Hex; index: number; before: string; after: string } {
  const body = signature.slice(2)
  if (body.length !== 130) throw new Error('Expected a 65-byte signature.')
  if (index < 0 || index >= 65) throw new Error('Byte index out of range.')
  const at = index * 2
  const before = body.slice(at, at + 2)
  const after = (parseInt(before, 16) ^ 0x01).toString(16).padStart(2, '0')
  return { tampered: `0x${body.slice(0, at)}${after}${body.slice(at + 2)}` as Hex, index, before: `0x${before}`, after: `0x${after}` }
}

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Finds the original attestation in the release transaction and proves it is genuine: the call must go
 * straight to ArcSLA, repeat the agreement's own spec, provider and evidence hashes, and its signature must
 * recover (locally, with this contract's EIP-712 domain) to the agreement's verifier.
 */
export async function loadOriginalAttestation(ctx: DemoContext, agreement: Agreement, releaseTx: Hex | undefined): Promise<LoadResult> {
  if (!releaseTx) return { ok: false, reason: 'The release transaction was not found in the loaded event history.' }
  let tx: Awaited<ReturnType<PublicClient['getTransaction']>>
  try {
    tx = await ctx.client.getTransaction({ hash: releaseTx })
  } catch {
    return { ok: false, reason: 'The release transaction could not be read from the network.' }
  }
  if (!tx.to || !sameAddr(tx.to, ctx.arcsla)) return { ok: false, reason: 'The release was not a direct call to ArcSLA, so its signature cannot be read.' }
  let decoded: ReturnType<typeof decodeFunctionData<typeof arcSlaAbi>>
  try {
    decoded = decodeFunctionData({ abi: arcSlaAbi, data: tx.input })
  } catch {
    return { ok: false, reason: 'The release transaction data could not be decoded.' }
  }
  if (decoded.functionName !== 'release') return { ok: false, reason: 'The transaction was not a release call.' }
  const [agreementId, specHash, provider, evidenceHash, expiry, signature] = decoded.args
  if (agreementId !== agreement.id) return { ok: false, reason: 'The transaction settles a different agreement.' }
  if (specHash !== agreement.specHash || !sameAddr(provider, agreement.provider) || evidenceHash !== agreement.evidenceHash) {
    return { ok: false, reason: 'The transaction data does not match the agreement record.' }
  }
  if (signature.length !== 132) return { ok: false, reason: 'The original signature is not a 65-byte signature.' }
  let recoveredSigner: Address
  try {
    recoveredSigner = await recoverTypedDataAddress({
      domain: { name: ATTESTATION_DOMAIN_NAME, version: ATTESTATION_DOMAIN_VERSION, chainId: ctx.chainId, verifyingContract: ctx.arcsla },
      types: FULFILLMENT_TYPES,
      primaryType: 'Fulfillment',
      message: { agreementId, specHash, provider, evidenceHash, expiry },
      signature,
    })
  } catch {
    return { ok: false, reason: 'The original signature could not be recovered.' }
  }
  if (!sameAddr(recoveredSigner, agreement.verifier)) return { ok: false, reason: 'The original signature does not recover to the agreement’s verifier.' }
  return { ok: true, attestation: { agreementId, specHash, provider, evidenceHash, expiry, signature, txHash: releaseTx, recoveredSigner } }
}

// ------------------------------------------------------------------ hypothetical Active copy (inside one eth_call)
// Storage layout of ArcSLA v1 (verified with `forge inspect ArcSLA storageLayout`): `_agreements` is the mapping at
// slot 2 and each Agreement takes 8 slots (status and createdAt share slot 6); `totalEscrowed` is slot 4.
const AGREEMENTS_SLOT = 2n
const TOTAL_ESCROWED_SLOT = toHex(4n, { size: 32 })
function agreementSlot(id: bigint, field: number): Hex {
  const base = hexToBigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [id, AGREEMENTS_SLOT])))
  return toHex(base + BigInt(field), { size: 32 })
}
function activeCopyOverride(ctx: DemoContext, a: Agreement) {
  return [
    {
      address: ctx.arcsla,
      // On Arc the USDC balance is the account's native balance (18 decimals): 6-decimal amount x 10^12.
      balance: a.amount * 10n ** 12n,
      stateDiff: [
        { slot: agreementSlot(a.id, 6), value: toHex(BigInt(a.createdAt) << 8n, { size: 32 }) },
        { slot: TOTAL_ESCROWED_SLOT, value: toHex(a.amount, { size: 32 }) },
      ],
    },
  ]
}

/**
 * Runs the three read-only simulations. Nothing is sent and no signature is requested.
 * `releasedAt` is the contract-recorded time of the original release (a moment when the attestation was valid).
 */
export async function runRejectionDemo(
  ctx: DemoContext,
  agreement: Agreement,
  att: OriginalAttestation,
  releasedAt: bigint,
  byteIndex = 4,
): Promise<RejectionResult> {
  const simulatedAt = [releasedAt, agreement.deadline, att.expiry].reduce((min, v) => (v < min ? v : min))
  const stateOverride = activeCopyOverride(ctx, agreement)
  const release = async (signature: Hex, hypothetical: boolean): Promise<Outcome> => {
    try {
      await ctx.client.simulateContract({
        address: ctx.arcsla,
        abi: arcSlaAbi,
        functionName: 'release',
        args: [att.agreementId, att.specHash, att.provider, att.evidenceHash, att.expiry, signature],
        ...(hypothetical ? { stateOverride, blockOverrides: { time: simulatedAt } } : {}),
      })
      return { kind: 'accepted' }
    } catch (error) {
      return { kind: 'rejected', name: revertName(error) }
    }
  }

  const realState = await release(att.signature, false)

  // Guard against a wrong storage assumption: the copy must equal the real agreement apart from its status.
  let copyMatchesAgreement = false
  try {
    const copy = await ctx.client.readContract({ address: ctx.arcsla, abi: arcSlaAbi, functionName: 'getAgreement', args: [agreement.id], stateOverride })
    copyMatchesAgreement =
      copy.status === 0 &&
      sameAddr(copy.customer, agreement.customer) &&
      sameAddr(copy.provider, agreement.provider) &&
      sameAddr(copy.verifier, agreement.verifier) &&
      copy.amount === agreement.amount &&
      copy.deadline === agreement.deadline &&
      copy.specHash === agreement.specHash &&
      copy.createdAt === agreement.createdAt &&
      copy.evidenceHash === agreement.evidenceHash
  } catch {
    copyMatchesAgreement = false
  }

  const tamperedByte = tamperOneByte(att.signature, byteIndex)
  if (!copyMatchesAgreement) {
    const unusable: Outcome = { kind: 'rejected', name: 'simulation unavailable' }
    return { realState, copyMatchesAgreement, control: unusable, tampered: unusable, tamperedByte: { index: tamperedByte.index, before: tamperedByte.before, after: tamperedByte.after }, simulatedAt, rejected: false }
  }
  const control = await release(att.signature, true)
  const tampered = await release(tamperedByte.tampered, true)
  const rejected = control.kind === 'accepted' && tampered.kind === 'rejected' && tampered.name === 'InvalidSigner'
  return { realState, copyMatchesAgreement, control, tampered, tamperedByte: { index: tamperedByte.index, before: tamperedByte.before, after: tamperedByte.after }, simulatedAt, rejected }
}
