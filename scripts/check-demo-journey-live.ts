/**
 * Read-only check of the Guided Demo journey against the real deployed contracts (no transactions, no signatures).
 *   bun run scripts/check-demo-journey-live.ts
 */
import { strict as assert } from 'node:assert'
import { createPublicClient, http, type Address } from 'viem'
import { arcSlaAbi } from '../src/contracts/ArcSLA.abi'
import { NETWORKS } from '../src/lib/networks'
import { computeJourneySteps, selectJourney, summarizeSteps, type ReceiptMap } from '../src/lib/demo-journey'
import type { Agreement, ArcEvent } from '../src/lib/types'

const RPC = { mainnet: 'https://rpc.mainnet.arc.io', testnet: 'https://rpc.testnet.arc.io' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= 5) throw e; await sleep(600 * 2 ** i) } }
}
let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; console.log('PASS', msg) }

for (const key of ['mainnet', 'testnet'] as const) {
  const dep = NETWORKS[key]
  const client = createPublicClient({ transport: http(RPC[key]) })
  const count = await retry(() => client.readContract({ address: dep.arcsla, abi: arcSlaAbi, functionName: 'agreementCount' }))
  const agreements: Agreement[] = []
  for (let id = 1n; id <= count; id++) {
    const a = await retry(() => client.readContract({ address: dep.arcsla, abi: arcSlaAbi, functionName: 'getAgreement', args: [id] }))
    agreements.push({ id, ...a, status: Number(a.status) })
  }
  const head = await retry(() => client.getBlockNumber())
  const events: ArcEvent[] = []
  for (let from = dep.deployBlock; from <= head; from += 10_000n) {
    const to = from + 9_999n > head ? head : from + 9_999n
    const logs = await retry(() => client.getContractEvents({ address: dep.arcsla, abi: arcSlaAbi, fromBlock: from, toBlock: to }))
    for (const l of logs) {
      const args = l.args as Record<string, unknown>
      const kind = l.eventName === 'AgreementCreated' ? 'created' : l.eventName === 'AgreementReleased' ? 'released' : 'refunded'
      events.push({
        kind, id: args.id as bigint, amount: args.amount as bigint, blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash,
        at: (args.createdAt ?? args.releasedAt ?? args.refundedAt) as bigint, submitter: args.submitter as Address | undefined,
      })
    }
    await sleep(120)
  }
  const receipts: ReceiptMap = {}
  for (const e of events.filter((x) => x.kind !== 'created')) {
    const r = await retry(() => client.getTransactionReceipt({ hash: e.txHash }))
    receipts[e.txHash.toLowerCase()] = { status: r.status, from: r.from, blockNumber: r.blockNumber }
  }
  console.log(`\n== ${key}: ${agreements.length} agreements, ${events.length} events, ${Object.keys(receipts).length} receipts read`)

  const rel = agreements.find((a) => a.status === 1)
  const ref = agreements.find((a) => a.status === 2)
  if (!rel || !ref) { console.log('(no released + refunded pair on this network; skipping wallet-switch comparison)'); continue }
  const wallets: Record<string, string | undefined> = { customer: rel.customer, verifier: rel.verifier, provider: rel.provider, none: undefined }
  const run = (wallet?: string, rejection = false) => {
    const selection = selectJourney({ agreements, wallet })
    const steps = computeJourneySteps({
      selection, wallet, isConnected: !!wallet, events, receipts, rolesSeen: [],
      rejection: rejection ? { outcome: 'InvalidSigner', via: 'demo', agreementId: '1' } : null,
    })
    return { selection, steps, sum: summarizeSteps(steps), done: steps.map((s) => (s.done ? 1 : 0)).join('') }
  }
  const results = Object.fromEntries(Object.entries(wallets).map(([role, w]) => [role, run(w)]))
  for (const [role, r] of Object.entries(results)) console.log(`  ${role.padEnd(9)} mode=${r.selection.mode.padEnd(11)} steps=${r.done} onchain=${r.sum.onchain}`)
  ok(results.customer.done === results.verifier.done && results.verifier.done === results.provider.done, `${key}: customer, verifier and provider wallets show identical progress`)
  ok(results.customer.done.slice(0, 8) === '11111111', `${key}: steps 1-8 are all complete from onchain evidence (${results.customer.sum.onchain} onchain)`)
  ok(results.customer.done[8] === '0', `${key}: step 9 stays open without a browser-local record`)
  ok(run(wallets.customer, true).done === '111111111', `${key}: with the browser-local rejection record, all nine steps complete (8 onchain + 1 browser)`)
  ok(run(wallets.verifier, true).sum.onchain === 8 && run(wallets.verifier, true).sum.browser === 1, `${key}: step 9 is counted as browser-local, not onchain`)
  ok(results.none.selection.mode === 'public' && !!results.none.selection.notice, `${key}: no wallet shows the labelled public journey`)
}
console.log(`\n${checks} live checks passed. Read-only: nothing was sent, signed or approved.`)
