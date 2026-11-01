/**
 * Offline tests for Guided Demo step 9 (no network, nothing sent or signed).   bun run scripts/check-demo-step9.ts
 * The live read-only test against the deployed contracts is scripts/check-rejection-demo.ts.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
}

const { markRejectionTested, readRejectionTested } = await import('../src/lib/attestation')
const { CHAIN_ID } = await import('../src/lib/env')
const { UNAVAILABLE_TITLE, tamperOneByte } = await import('../src/lib/rejection-demo')

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('PASS', name) }
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('nothing is completed until a result is recorded', () => assert.equal(readRejectionTested(), null))
test('a recorded result is stored under a per-network key and read back', () => {
  markRejectionTested('InvalidSigner', { via: 'demo', agreementId: '1' })
  assert.ok(store.has(`arcsla.rejectionTested.${CHAIN_ID}`))
  const r = readRejectionTested()
  assert.equal(r?.outcome, 'InvalidSigner'); assert.equal(r?.via, 'demo'); assert.equal(r?.agreementId, '1')
})
test('the old global key (written before per-network keys) never marks step 9 complete', () => {
  store.clear(); store.set('arcsla.rejectionTested', 'InvalidSigner')
  assert.equal(readRejectionTested(), null)
})
test('a result recorded for another network is not shown on this one', () => {
  store.clear(); store.set(`arcsla.rejectionTested.${CHAIN_ID === 5042 ? 5042002 : 5042}`, JSON.stringify({ outcome: 'InvalidSigner', at: new Date().toISOString(), via: 'demo' }))
  assert.equal(readRejectionTested(), null)
})
test('corrupt storage is ignored, not trusted', () => {
  store.clear(); store.set(`arcsla.rejectionTested.${CHAIN_ID}`, '{not json'); assert.equal(readRejectionTested(), null)
  store.set(`arcsla.rejectionTested.${CHAIN_ID}`, JSON.stringify({ outcome: 7 })); assert.equal(readRejectionTested(), null)
})
test('the verifier console still records through the same function', () => {
  store.clear(); markRejectionTested('InvalidSigner'); assert.equal(readRejectionTested()?.via, 'verifier')
})
test('the unavailable message is the required wording', () => assert.equal(UNAVAILABLE_TITLE, 'Test unavailable: original signature required'))
test('tampering changes exactly one byte', () => {
  const sig: `0x${string}` = `0x${'cd'.repeat(65)}`
  const t = tamperOneByte(sig, 4)
  let diff = 0
  for (let i = 0; i < 65; i++) if (t.tampered.slice(2 + 2 * i, 4 + 2 * i) !== sig.slice(2 + 2 * i, 4 + 2 * i)) diff++
  assert.equal(diff, 1)
})

// ---- wiring: step 9 can only complete after a real read-only rejection
const rt = read('../src/components/RejectionTest.tsx')
const demo = read('../src/pages/Demo.tsx')
test('RejectionTest records completion only inside the "rejected" branch, never on unavailable or inconclusive paths', () => {
  const calls = rt.split('markRejectionTested(').length - 1
  assert.equal(calls, 1)
  const at = rt.indexOf('markRejectionTested(')
  assert.ok(rt.lastIndexOf('if (result.rejected)', at) > -1)
  assert.ok(rt.slice(rt.lastIndexOf('if (result.rejected)', at), at).length < 40)
})
test('RejectionTest sends nothing: no write hook, no signing hook, no wallet request', () => {
  assert.doesNotMatch(rt, /useWriteContract|useSignTypedData|writeContract|sendTransaction|signMessage|eth_sendTransaction|useTx\(/)
  const lib = read('../src/lib/rejection-demo.ts')
  assert.doesNotMatch(lib, /writeContract|sendTransaction|signTypedData|signMessage|walletClient/)
  assert.match(lib, /simulateContract/)
})
test('the unavailable path shows the required message and leaves step 9 open', () => {
  assert.match(rt, /UNAVAILABLE_TITLE/)
  assert.match(rt, /Nothing was recorded and step 9 stays open/)
})
test('results label onchain evidence, read-only simulation and browser-local notes separately', () => {
  for (const label of ['Onchain evidence', 'Read-only simulation', 'Browser-local note']) assert.ok(rt.includes(label), label)
  assert.match(rt, /not an onchain record/)
})
test('Demo step 9 uses the test; completion comes only from the stored browser record and is labelled browser-local', () => {
  assert.match(demo, /<RejectionTest onCompleted=\{refreshRejection\} \/>/)
  assert.match(demo, /rejection,\n?\s*\}\)|rejection,\s*$/m)
  const journey = read('../src/lib/demo-journey.ts')
  assert.match(journey, /id: 9, done: !!input\.rejection, evidenceKind: input\.rejection \? 'browser'/)
  assert.match(journey, /Recorded in this browser only; it is not an onchain record/)
  for (const t of ['Watch an invalid signature get rejected', 'Let the deadline pass and claim the refund']) assert.ok(demo.includes(t), t)
})

console.log(`\n${passed} step-9 tests passed. Nothing was sent or signed.`)
