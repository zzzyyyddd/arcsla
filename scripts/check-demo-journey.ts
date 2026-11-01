/**
 * Offline regression tests for Guided Demo progress across wallet switches (no network, nothing sent or signed).
 * Fixtures mirror the real Arc Mainnet evidence: #1 Released 0.01 USDC, #2 Refunded 0.01 USDC.
 *   bun run scripts/check-demo-journey.ts
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import type { Address, Hex } from 'viem'
import {
  computeJourneySteps, listJourneys, markRolesSeen, readRolesSeen, selectJourney, summarizeSteps,
  type DemoRejection, type ReceiptMap, type Role, type SeenStore,
} from '../src/lib/demo-journey'
import type { Agreement, ArcEvent } from '../src/lib/types'

const CUSTOMER = '0xCfEfEc595970C6850777ac44A99Dd949fAc472A6' as Address
const PROVIDER = '0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc' as Address
const VERIFIER = '0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3' as Address
const STRANGER = '0x00000000000000000000000000000000000000aa' as Address
const h = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
const ZERO = h(0)

const a1: Agreement = { id: 1n, customer: CUSTOMER, provider: PROVIDER, verifier: VERIFIER, amount: 10000n, deadline: 1793420820n, specHash: h(11), status: 1, createdAt: 1793417487n, evidenceHash: h(12) }
const a2: Agreement = { id: 2n, customer: CUSTOMER, provider: PROVIDER, verifier: VERIFIER, amount: 10000n, deadline: 1793419140n, specHash: h(21), status: 2, createdAt: 1793418701n, evidenceHash: ZERO }
const ev = (kind: ArcEvent['kind'], id: bigint, tx: Hex, at: bigint, extra: Partial<ArcEvent> = {}): ArcEvent => ({ kind, id, amount: 10000n, at, blockNumber: 1n, logIndex: 0, txHash: tx, ...extra })
const T_C1 = h(0xc1), T_REL = h(0xe1), T_C2 = h(0xc2), T_REF = h(0xf2)
const EVENTS: ArcEvent[] = [
  ev('created', 1n, T_C1, 1793417487n), ev('released', 1n, T_REL, 1793418136n, { submitter: VERIFIER }),
  ev('created', 2n, T_C2, 1793418701n), ev('refunded', 2n, T_REF, 1793419226n),
]
const RECEIPTS: ReceiptMap = {
  [T_REL]: { status: 'success', from: VERIFIER, blockNumber: 28754752n },
  [T_REF]: { status: 'success', from: CUSTOMER, blockNumber: 28756901n },
}
const REJECTION: DemoRejection = { outcome: 'InvalidSigner', via: 'demo', agreementId: '1' }

interface Opts { agreements?: Agreement[]; wallet?: string; connected?: boolean; events?: ArcEvent[]; receipts?: ReceiptMap; seen?: Role[]; rejection?: DemoRejection | null; preferred?: string }
function run(o: Opts = {}) {
  const wallet = o.wallet
  const selection = selectJourney({ agreements: o.agreements ?? [a1, a2], wallet, preferredKey: o.preferred })
  const steps = computeJourneySteps({
    selection, wallet, isConnected: o.connected ?? !!wallet, events: o.events ?? EVENTS, receipts: o.receipts ?? RECEIPTS,
    rolesSeen: o.seen ?? [], rejection: o.rejection === undefined ? REJECTION : o.rejection,
  })
  return { selection, steps, done: steps.map((s) => s.done), kinds: steps.map((s) => s.evidenceKind), sum: summarizeSteps(steps) }
}

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('PASS', name) }
const ALL9 = [true, true, true, true, true, true, true, true, true]

test('customer connected: all nine steps, 8 onchain + 1 browser-local (the reported 8/9 bug)', () => {
  const r = run({ wallet: CUSTOMER })
  assert.deepEqual(r.done, ALL9); assert.equal(r.sum.onchain, 8); assert.equal(r.sum.browser, 1); assert.equal(r.kinds[8], 'browser')
})
test('verifier connected: identical result (the reported 6/9 bug)', () => {
  const r = run({ wallet: VERIFIER })
  assert.deepEqual(r.done, ALL9); assert.deepEqual(r.kinds, run({ wallet: CUSTOMER }).kinds)
})
test('provider connected: identical result', () => assert.deepEqual(run({ wallet: PROVIDER }).done, ALL9))
test('switching customer -> verifier -> customer keeps one journey and one progress state', () => {
  const seq = [CUSTOMER, VERIFIER, CUSTOMER].map((w) => run({ wallet: w }))
  assert.deepEqual(seq.map((r) => r.selection.journey?.key), [seq[0].selection.journey?.key, seq[0].selection.journey?.key, seq[0].selection.journey?.key])
  assert.deepEqual(seq.map((r) => r.selection.roles), [['customer'], ['verifier'], ['customer']])
  for (const r of seq) { assert.deepEqual(r.done, ALL9); assert.deepEqual(r.sum, seq[0].sum) }
})
test('customer and verifier identities stay distinct in the journey', () => {
  const j = run({ wallet: VERIFIER }).selection.journey!
  assert.equal(j.customer, CUSTOMER); assert.equal(j.verifier, VERIFIER); assert.deepEqual(j.providers, [PROVIDER])
  assert.notEqual(j.customer.toLowerCase(), j.verifier.toLowerCase())
})
test('no wallet connected: shows the public onchain journey, labelled, with step 1 not claimed as a browser connection', () => {
  const r = run({ connected: false })
  assert.equal(r.selection.mode, 'public'); assert.match(r.selection.notice ?? '', /No wallet is connected/)
  assert.equal(r.steps[0].evidenceKind, 'onchain'); assert.match(r.steps[1].reason ?? '', /public onchain data/)
})
test('unrelated wallet: role cannot be established, so it says so instead of guessing', () => {
  const r = run({ wallet: STRANGER })
  assert.equal(r.selection.mode, 'public'); assert.deepEqual(r.selection.roles, [])
  assert.match(r.selection.notice ?? '', /role cannot be established/); assert.match(r.selection.notice ?? '', /not progress made by this wallet/)
})
test('a fresh wallet with no agreements anywhere: only the browser connection counts', () => {
  const r = run({ agreements: [], events: [], wallet: STRANGER })
  assert.equal(r.selection.mode, 'none'); assert.equal(r.sum.onchain, 0); assert.equal(r.sum.browser, 2)
  assert.deepEqual(r.done.slice(1, 8), [false, false, false, false, false, false, false])
  assert.equal(run({ agreements: [], events: [], connected: false }).done[0], false)
})
test('step 9 stays browser-local and never changes the onchain count', () => {
  const without = run({ wallet: CUSTOMER, rejection: null })
  assert.equal(without.done[8], false); assert.equal(without.sum.done, 8); assert.equal(without.sum.onchain, 8); assert.equal(without.sum.browser, 0)
  const withIt = run({ wallet: CUSTOMER })
  assert.equal(withIt.sum.onchain, 8); assert.match(withIt.steps[8].evidence[0].text, /not an onchain record/)
})
test('settlement tx: needs the release event AND a successful receipt', () => {
  assert.equal(run({ wallet: CUSTOMER, events: EVENTS.filter((e) => e.kind !== 'released') }).done[5], false)
  assert.match(run({ wallet: CUSTOMER, events: EVENTS.filter((e) => e.kind !== 'released') }).steps[5].reason ?? '', /not in the scanned history/)
  assert.equal(run({ wallet: CUSTOMER, receipts: { ...RECEIPTS, [T_REL]: 'pending' } }).done[5], false)
  assert.equal(run({ wallet: CUSTOMER, receipts: {} }).done[5], false)
  assert.equal(run({ wallet: CUSTOMER, receipts: { ...RECEIPTS, [T_REL]: 'missing' } }).done[5], false)
  assert.equal(run({ wallet: CUSTOMER, receipts: { ...RECEIPTS, [T_REL]: { status: 'reverted', from: VERIFIER, blockNumber: 1n } } }).done[5], false)
  assert.equal(run({ wallet: CUSTOMER }).done[5], true)
})
test('the states-only steps do not depend on receipts or events', () => {
  const r = run({ wallet: CUSTOMER, events: [], receipts: {} })
  assert.deepEqual([r.done[1], r.done[3], r.done[4], r.done[6], r.done[7]], [true, true, true, true, true])
  assert.equal(r.done[5], false) // the settlement transaction itself needs its event and receipt
})
test('refund: needs a successful receipt and a refund after the deadline', () => {
  assert.equal(run({ wallet: VERIFIER, receipts: { ...RECEIPTS, [T_REF]: 'pending' } }).done[7], false)
  assert.equal(run({ wallet: VERIFIER, receipts: { [T_REL]: RECEIPTS[T_REL] } }).done[7], false)
  assert.equal(run({ wallet: VERIFIER, events: EVENTS.map((e) => e.kind === 'refunded' ? { ...e, at: a2.deadline } : e) }).done[7], false)
  const noEvent = run({ wallet: VERIFIER, events: EVENTS.filter((e) => e.kind !== 'refunded') })
  assert.equal(noEvent.done[7], true); assert.match(noEvent.steps[7].evidence[0].text, /not in the scanned history/)
  assert.match(run({ wallet: VERIFIER }).steps[7].evidence[0].text, /sent by .*\(the customer\)/)
})
test('step 7 needs a distinct short-deadline agreement and explains otherwise', () => {
  assert.equal(run({ wallet: CUSTOMER, agreements: [a1] }).done[6], false)
  const longSecond: Agreement = { ...a2, deadline: a2.createdAt + 86400n }
  const r = run({ wallet: CUSTOMER, agreements: [a1, longSecond] })
  assert.equal(r.done[6], false); assert.match(r.steps[6].reason ?? '', /1440-minute deadline/)
})
test('an Active agreement: verifier steps stay open until there is evidence', () => {
  const active: Agreement = { ...a1, status: 0, evidenceHash: ZERO }
  const c = run({ agreements: [active], events: EVENTS.slice(0, 1), wallet: CUSTOMER })
  assert.deepEqual(c.done, [true, true, false, false, false, false, false, false, true])
  assert.equal(c.steps[2].reason?.includes('Connect the verifier wallet'), true)
})
test('verifier connection seen before release is remembered, so switching back does not undo step 3', () => {
  const active: Agreement = { ...a1, status: 0, evidenceHash: ZERO }
  const j = selectJourney({ agreements: [active], wallet: CUSTOMER }).journey!
  const store = new Map<string, string>()
  const seenStore: SeenStore = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) }
  const view = (wallet: string) => {
    const roles = selectJourney({ agreements: [active], wallet }).roles
    markRolesSeen(seenStore, 5042, j.key, roles)
    return run({ agreements: [active], events: EVENTS.slice(0, 1), wallet, seen: readRolesSeen(seenStore, 5042, j.key) })
  }
  assert.equal(view(CUSTOMER).done[2], false)
  const asVerifier = view(VERIFIER); assert.equal(asVerifier.done[2], true); assert.equal(asVerifier.kinds[2], 'browser')
  const back = view(CUSTOMER); assert.equal(back.done[2], true); assert.equal(back.kinds[2], 'browser')
  assert.equal(run({ wallet: CUSTOMER, seen: ['verifier'] }).kinds[2], 'onchain')
})
test('role memory is per network, ignores corrupt data and is idempotent', () => {
  const store = new Map<string, string>()
  const s: SeenStore = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) }
  assert.equal(markRolesSeen(s, 5042, 'k', ['verifier']), true); assert.equal(markRolesSeen(s, 5042, 'k', ['verifier']), false)
  assert.deepEqual(readRolesSeen(s, 5042, 'k'), ['verifier']); assert.deepEqual(readRolesSeen(s, 5042002, 'k'), [])
  store.set('arcsla.demoSeen.5042.bad', '{nope'); assert.deepEqual(readRolesSeen(s, 5042, 'bad'), [])
  store.set('arcsla.demoSeen.5042.junk', '["admin",1,"customer"]'); assert.deepEqual(readRolesSeen(s, 5042, 'junk'), ['customer'])
})
test('several journeys: the most complete is chosen, a stored choice is respected, a wallet only sees its own', () => {
  const other: Agreement = { ...a1, id: 3n, customer: STRANGER, verifier: '0x00000000000000000000000000000000000000bb', status: 0, evidenceHash: ZERO }
  const all = [a1, a2, other]
  assert.equal(listJourneys(all).length, 2)
  assert.equal(selectJourney({ agreements: all }).journey?.customer, CUSTOMER)
  assert.equal(selectJourney({ agreements: all, wallet: STRANGER }).journey?.customer, STRANGER)
  assert.equal(selectJourney({ agreements: all, wallet: CUSTOMER, preferredKey: listJourneys(all)[1].key }).journey?.customer, CUSTOMER)
  assert.equal(selectJourney({ agreements: all, preferredKey: listJourneys(all)[1].key }).journey?.customer, STRANGER)
})
test('a wallet in two journeys keeps the preferred one across switches', () => {
  const second: Agreement = { ...a1, id: 3n, verifier: '0x00000000000000000000000000000000000000bb', status: 0, evidenceHash: ZERO }
  const all = [a1, a2, second]
  const keys = listJourneys(all).map((j) => j.key)
  const pick = (w: string, preferred?: string) => selectJourney({ agreements: all, wallet: w, preferredKey: preferred }).journey?.key
  assert.equal(pick(CUSTOMER), keys[0]); assert.equal(pick(CUSTOMER, keys[1]), keys[1]); assert.equal(pick(CUSTOMER, keys[0]), keys[0])
})

// ---- wiring
const demo = readFileSync(new URL('../src/pages/Demo.tsx', import.meta.url), 'utf8')
test('Demo.tsx derives steps from the journey, not from per-wallet filters', () => {
  assert.match(demo, /computeJourneySteps\(/); assert.match(demo, /selectJourney\(/)
  assert.doesNotMatch(demo, /sameAddress\(a\.customer, address\)|sameAddress\(a\.verifier, address\)|verifying\.length|releasedMine|refundedMine/)
})
test('Demo.tsx never sends or signs anything', () => assert.doesNotMatch(demo, /useWriteContract|useSignTypedData|writeContract|sendTransaction|signMessage|useTx\(/))
test('Demo.tsx keeps all nine step titles', () => {
  for (const t of ['Connect the customer wallet', 'Create and fund a small agreement', 'Connect the verifier wallet', 'Sign a fulfillment attestation', 'Release payment to the provider', 'View the confirmed settlement transaction', 'Create a second agreement with a short deadline', 'Let the deadline pass and claim the refund', 'Watch an invalid signature get rejected']) assert.ok(demo.includes(t), t)
})

console.log(`\n${passed} journey tests passed. Nothing was sent or signed.`)
