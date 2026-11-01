/**
 * Guided Demo progress, derived from ONE settlement journey instead of the connected wallet.
 *
 * A journey is the set of agreements that share the same customer + verifier pair. The connected wallet only
 * decides which journey to show (it must be the customer, verifier or provider of it); it never decides whether
 * an onchain step is complete. Transaction-related steps come from agreement states, events and receipts.
 * Pure functions: no React, no RPC, no environment, so they can be tested offline.
 */
import type { Address, Hex } from 'viem'
import type { Agreement, ArcEvent } from './types'

export type Role = 'customer' | 'verifier' | 'provider'
export type EvidenceKind = 'onchain' | 'browser' | 'none'
export const SHORT_DEADLINE_SECONDS = 3600

export interface Journey {
  key: string
  customer: Address
  verifier: Address
  providers: Address[]
  agreements: Agreement[]
}
export type ReceiptInfo = { status: 'success' | 'reverted'; from: Address; blockNumber: bigint }
/** Keyed by lowercase transaction hash. 'pending' = still loading, 'missing' = RPC has no receipt. */
export type ReceiptMap = Record<string, ReceiptInfo | 'pending' | 'missing'>

export interface Selection {
  journey?: Journey
  mode: 'participant' | 'public' | 'none'
  roles: Role[]
  notice?: string
}
export type Evidence = { text: string; txHash?: Hex }
export interface StepResult {
  id: number
  done: boolean
  evidenceKind: EvidenceKind
  evidence: Evidence[]
  /** Why the step is not complete, or a caveat. Shown instead of guessing. */
  reason?: string
}
export interface DemoRejection { outcome: string; via: string; agreementId?: string }

const lc = (v?: string) => (v ?? '').toLowerCase()
const same = (a?: string, b?: string) => !!a && !!b && lc(a) === lc(b)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const journeyKey = (a: Pick<Agreement, 'customer' | 'verifier'>) => `${lc(a.customer)}|${lc(a.verifier)}`

function score(j: Journey) {
  return (j.agreements.some((a) => a.status === 1) ? 2 : 0) + (j.agreements.some((a) => a.status === 2) ? 2 : 0) + j.agreements.length
}

/** All journeys, most complete first (ties: the one with the newest agreement). */
export function listJourneys(agreements: readonly Agreement[]): Journey[] {
  const map = new Map<string, Journey>()
  for (const a of [...agreements].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const key = journeyKey(a)
    const j = map.get(key) ?? { key, customer: a.customer, verifier: a.verifier, providers: [], agreements: [] }
    j.agreements.push(a)
    if (!j.providers.some((p) => same(p, a.provider))) j.providers.push(a.provider)
    map.set(key, j)
  }
  const newest = (j: Journey) => j.agreements[j.agreements.length - 1].id
  return [...map.values()].sort((a, b) => score(b) - score(a) || (newest(b) > newest(a) ? 1 : -1))
}

export function rolesOf(j: Journey, wallet?: string): Role[] {
  if (!wallet) return []
  const roles: Role[] = []
  if (same(j.customer, wallet)) roles.push('customer')
  if (same(j.verifier, wallet)) roles.push('verifier')
  if (j.providers.some((p) => same(p, wallet))) roles.push('provider')
  return roles
}

export function selectJourney(input: { agreements: readonly Agreement[]; wallet?: string; preferredKey?: string | null }): Selection {
  const journeys = listJourneys(input.agreements)
  if (journeys.length === 0) return { mode: 'none', roles: [] }
  const preferred = journeys.find((j) => j.key === input.preferredKey)
  if (input.wallet) {
    const mine = journeys.filter((j) => rolesOf(j, input.wallet).length > 0)
    if (mine.length > 0) {
      const journey = mine.find((j) => j.key === input.preferredKey) ?? mine[0]
      return { journey, mode: 'participant', roles: rolesOf(journey, input.wallet) }
    }
    return {
      journey: preferred ?? journeys[0],
      mode: 'public',
      roles: [],
      notice: `The connected wallet ${short(input.wallet)} has not taken part in any agreement here (as customer, verifier or provider), so its role cannot be established. Showing the recorded public journey instead. This is not progress made by this wallet.`,
    }
  }
  return {
    journey: preferred ?? journeys[0],
    mode: 'public',
    roles: [],
    notice: 'No wallet is connected. Showing the recorded public journey from onchain data. Connect the customer, verifier or provider wallet to follow your own.',
  }
}

/** Roles seen connected in this browser for a journey (browser-local; used only before onchain evidence exists). */
export interface SeenStore { get(key: string): string | null; set(key: string, value: string): void }
const seenKey = (chainId: number, journeyKey_: string) => `arcsla.demoSeen.${chainId}.${journeyKey_}`
export function readRolesSeen(store: SeenStore, chainId: number, key: string): Role[] {
  try {
    const parsed: unknown = JSON.parse(store.get(seenKey(chainId, key)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((r): r is Role => r === 'customer' || r === 'verifier' || r === 'provider') : []
  } catch { return [] }
}
export function markRolesSeen(store: SeenStore, chainId: number, key: string, roles: readonly Role[]): boolean {
  const seen = new Set(readRolesSeen(store, chainId, key))
  const before = seen.size
  for (const r of roles) seen.add(r)
  if (seen.size === before) return false
  store.set(seenKey(chainId, key), JSON.stringify([...seen]))
  return true
}

export interface StepsInput {
  selection: Selection
  wallet?: string
  isConnected: boolean
  events: readonly ArcEvent[]
  receipts: ReceiptMap
  /** Roles seen connected in this browser for the selected journey. */
  rolesSeen: readonly Role[]
  rejection: DemoRejection | null
}

type Receipt = ReceiptInfo | 'pending' | 'missing' | undefined
const receiptState = (receipts: ReceiptMap, hash: Hex): Receipt => receipts[lc(hash)]
const amountText = (a: Agreement) => `${(Number(a.amount) / 1e6).toFixed(Number(a.amount) % 10000 === 0 ? 2 : 6)} USDC`

/** Evaluate the nine steps for the selected journey. Never reads the connected wallet to decide an onchain step. */
export function computeJourneySteps(input: StepsInput): StepResult[] {
  const { selection, wallet, events, receipts } = input
  const j = selection.journey
  const list = j?.agreements ?? []
  const roles = selection.roles
  const released = list.filter((a) => a.status === 1)
  const refunded = list.filter((a) => a.status === 2)
  const ev = (kind: ArcEvent['kind'], a: Agreement) => events.find((e) => e.kind === kind && e.id === a.id)
  const steps: StepResult[] = []
  const add = (s: Omit<StepResult, 'evidence'> & { evidence?: Evidence[] }) => steps.push({ evidence: [], ...s })

  // 1. Customer wallet
  if (j && list.length > 0) {
    const created = ev('created', list[0])
    add({
      id: 1, done: true, evidenceKind: 'onchain',
      evidence: [{ text: `Customer ${short(j.customer)} funded agreement #${list[0].id} (state read from the contract)`, txHash: created?.txHash }],
      reason: roles.includes('customer') ? undefined : wallet && selection.mode === 'participant' ? `You are connected as the ${roles.join(' and ')}; the customer wallet is identified from the funding transaction, not from your connection.` : undefined,
    })
  } else if (input.isConnected && wallet) {
    add({ id: 1, done: true, evidenceKind: 'browser', evidence: [{ text: `Connected as ${short(wallet)} in this browser. It becomes the customer once it funds an agreement.` }] })
  } else {
    add({ id: 1, done: false, evidenceKind: 'none', reason: 'Connect a wallet that holds USDC.' })
  }

  // 2. Create and fund
  add({
    id: 2, done: list.length >= 1, evidenceKind: list.length ? 'onchain' : 'none',
    evidence: list.map((a) => ({ text: `Agreement #${a.id}: ${amountText(a)}, provider ${short(a.provider)}, verifier ${short(a.verifier)}`, txHash: ev('created', a)?.txHash })),
    reason: list.length ? (selection.mode === 'public' ? 'Shown from public onchain data, not from the connected wallet.' : undefined) : 'No funded agreement for this journey yet.',
  })

  // 3. Verifier wallet
  const verifierSeen = roles.includes('verifier') || input.rolesSeen.includes('verifier')
  if (released.length > 0 && j) {
    const rel = ev('released', released[0])
    add({
      id: 3, done: true, evidenceKind: 'onchain',
      evidence: [{ text: `The contract accepted an EIP-712 signature from verifier ${short(j.verifier)} on agreement #${released[0].id}${rel?.submitter && same(rel.submitter, j.verifier) ? ' and the verifier wallet itself sent the release' : ''}.`, txHash: rel?.txHash }],
      reason: roles.includes('verifier') ? undefined : 'Identified from the settled agreement, not from your current connection.',
    })
  } else if (verifierSeen && j) {
    add({ id: 3, done: true, evidenceKind: 'browser', evidence: [{ text: `Verifier wallet ${short(j.verifier)} was connected in this browser (not yet confirmed onchain).` }] })
  } else {
    add({ id: 3, done: false, evidenceKind: 'none', reason: j ? `Connect the verifier wallet ${short(j.verifier)}.` : 'Create an agreement first; its verifier is the wallet to connect.' })
  }

  // 4 and 5. Attestation and release (agreement state)
  const relEv = released[0] ? ev('released', released[0]) : undefined
  add({
    id: 4, done: released.length >= 1, evidenceKind: released.length ? 'onchain' : 'none',
    evidence: released[0] ? [{ text: `Agreement #${released[0].id} is Released with evidence hash ${released[0].evidenceHash.slice(0, 10)}…, which the contract only stores after verifying the verifier's signature.`, txHash: relEv?.txHash }] : [],
    reason: released.length ? undefined : 'No release yet. The verifier signs an attestation, then anyone submits it.',
  })
  add({
    id: 5, done: released.length >= 1, evidenceKind: released.length ? 'onchain' : 'none',
    evidence: released[0] ? [{ text: `Agreement #${released[0].id}: ${amountText(released[0])} released to provider ${short(released[0].provider)}`, txHash: relEv?.txHash }] : [],
    reason: released.length ? undefined : 'No payment released yet.',
  })

  // 6. Settlement transaction (event + receipt)
  {
    let done = false
    let reason: string | undefined = released.length ? undefined : 'No settlement transaction yet.'
    const evidence: Evidence[] = []
    if (released[0]) {
      if (!relEv) reason = `Agreement #${released[0].id} is Released but its release event is not in the scanned history, so the transaction cannot be shown.`
      else {
        const r = receiptState(receipts, relEv.txHash)
        if (r === 'pending' || r === undefined) reason = 'Checking the transaction receipt…'
        else if (r === 'missing') reason = 'The RPC returned no receipt for the release transaction.'
        else if (r.status !== 'success') reason = 'The release transaction receipt is not successful.'
        else {
          done = true
          evidence.push({ text: `Receipt: success in block ${r.blockNumber}, sent by ${short(r.from)}${relEv.submitter && same(relEv.submitter, r.from) ? ' (the submitter named in the event)' : ''}.`, txHash: relEv.txHash })
        }
      }
    }
    add({ id: 6, done, evidenceKind: done ? 'onchain' : 'none', evidence, reason })
  }

  // 7. Second agreement with a short deadline (distinct from the released one)
  {
    const base = released[0] ?? list[0]
    const others = base ? list.filter((a) => a.id !== base.id) : []
    const windowOf = (a: Agreement) => Number(a.deadline - a.createdAt)
    const shortOne = others.find((a) => windowOf(a) <= SHORT_DEADLINE_SECONDS)
    add({
      id: 7, done: !!shortOne, evidenceKind: shortOne ? 'onchain' : 'none',
      evidence: shortOne ? [{ text: `Agreement #${shortOne.id}: ${amountText(shortOne)} with a ${Math.round(windowOf(shortOne) / 60)}-minute deadline`, txHash: ev('created', shortOne)?.txHash }] : [],
      reason: shortOne ? undefined : others.length ? `Agreement #${others[0].id} has a ${Math.round(windowOf(others[0]) / 60)}-minute deadline; the demo asks for a short one (1 hour or less).` : 'No second agreement yet.',
    })
  }

  // 8. Deadline passed and refunded (state + receipt)
  {
    const r0 = refunded[0]
    let done = false
    let reason: string | undefined = r0 ? undefined : 'No refund yet. The customer can claim it after the deadline.'
    const evidence: Evidence[] = []
    if (r0) {
      const refEv = ev('refunded', r0)
      const afterDeadline = refEv ? refEv.at > r0.deadline : true
      if (!afterDeadline) reason = `Agreement #${r0.id} was refunded at or before its deadline, which the contract does not allow; not counted.`
      else if (!refEv) { done = true; evidence.push({ text: `Agreement #${r0.id} is Refunded (state); its refund event is not in the scanned history.` }) }
      else {
        const r = receiptState(receipts, refEv.txHash)
        if (r === 'pending' || r === undefined) reason = 'Checking the refund transaction receipt…'
        else if (r === 'missing') reason = 'The RPC returned no receipt for the refund transaction.'
        else if (r.status !== 'success') reason = 'The refund transaction receipt is not successful.'
        else {
          done = true
          evidence.push({ text: `Agreement #${r0.id}: ${amountText(r0)} refunded to customer ${short(r0.customer)} ${Number(refEv.at - r0.deadline)}s after the deadline; sent by ${short(r.from)}${same(r.from, r0.customer) ? ' (the customer)' : ''}.`, txHash: refEv.txHash })
        }
      }
    }
    add({ id: 8, done, evidenceKind: done ? 'onchain' : 'none', evidence, reason })
  }

  // 9. Browser-local read-only rejection test (never onchain evidence)
  add({
    id: 9, done: !!input.rejection, evidenceKind: input.rejection ? 'browser' : 'none',
    evidence: input.rejection ? [{ text: `Read-only simulation answered ${input.rejection.outcome}. Recorded in this browser only; it is not an onchain record.` }] : [],
    reason: input.rejection ? undefined : 'Run the read-only rejection test below.',
  })
  return steps
}

export function summarizeSteps(steps: readonly StepResult[]) {
  return {
    total: steps.length,
    done: steps.filter((s) => s.done).length,
    onchain: steps.filter((s) => s.done && s.evidenceKind === 'onchain').length,
    browser: steps.filter((s) => s.done && s.evidenceKind === 'browser').length,
  }
}
