/**
 * Live, read-only test of the Guided Demo "invalid signature is rejected" logic (src/lib/rejection-demo.ts)
 * against the REAL deployed contracts. Only eth_call, eth_getLogs and eth_getTransaction are used:
 * nothing is sent, signed or approved.   bun run scripts/check-rejection-demo.ts
 */
import { strict as assert } from 'node:assert'
import { createPublicClient, http, type Hex, type PublicClient } from 'viem'
import { arcSlaAbi } from '../src/contracts/ArcSLA.abi'
import { NETWORKS } from '../src/lib/networks'
import { loadOriginalAttestation, runRejectionDemo, tamperOneByte, type DemoContext } from '../src/lib/rejection-demo'
import type { Agreement } from '../src/lib/types'

const RPC = { testnet: 'https://rpc.testnet.arc.io', mainnet: 'https://rpc.mainnet.arc.io' } as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const BAD_SPEC: Hex = `0x${'11'.repeat(32)}`
const check = (name: string, fn: () => void) => { fn(); passed++; console.log('PASS', name) }

for (const key of ['mainnet', 'testnet'] as const) {
  const net = NETWORKS[key]
  const client = createPublicClient({ transport: http(RPC[key], { retryCount: 8, retryDelay: 800 }) }) as unknown as PublicClient
  const ctx: DemoContext = { client, arcsla: net.arcsla, chainId: net.chainId }
  console.log(`\n=== ${net.label} (${net.chainId}) ${net.arcsla}`)
  const a = (await client.readContract({ address: net.arcsla, abi: arcSlaAbi, functionName: 'getAgreement', args: [1n] })) as unknown as Omit<Agreement, 'id'>
  const agreement: Agreement = { id: 1n, ...a }
  assert.equal(agreement.status, 1, 'agreement #1 is expected to be Released on this network')
  // events: find the release and creation transactions of agreement #1
  const head = await client.getBlockNumber()
  let from = net.deployBlock, released: { tx: Hex; at: bigint } | undefined, created: Hex | undefined
  while (from <= head) {
    const to = from + 9_999n > head ? head : from + 9_999n
    for (const l of await client.getContractEvents({ address: net.arcsla, abi: arcSlaAbi, fromBlock: from, toBlock: to })) {
      const args = l.args as unknown as { id: bigint; releasedAt?: bigint }
      if (args.id !== 1n) continue
      if (l.eventName === 'AgreementReleased') released = { tx: l.transactionHash, at: args.releasedAt as bigint }
      if (l.eventName === 'AgreementCreated') created = l.transactionHash
    }
    from = to + 1n
    await sleep(300)
  }
  assert.ok(released && created, 'release and creation events found')

  const loaded = await loadOriginalAttestation(ctx, agreement, released.tx)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.reason)
  check(`${key}: original attestation read from release tx ${released.tx.slice(0, 12)}… recovers to the verifier`, () => {
    assert.equal(loaded.attestation.recoveredSigner.toLowerCase(), agreement.verifier.toLowerCase())
    assert.equal(loaded.attestation.signature.length, 132)
  })

  const r = await runRejectionDemo(ctx, agreement, loaded.attestation, released.at)
  console.log(JSON.stringify({ realState: r.realState, copyMatchesAgreement: r.copyMatchesAgreement, control: r.control, tampered: r.tampered, tamperedByte: r.tamperedByte, simulatedAt: r.simulatedAt.toString(), rejected: r.rejected }))
  check(`${key}: real state answers AgreementNotActive (agreement is settled; not a signature test)`, () => assert.deepEqual(r.realState, { kind: 'rejected', name: 'AgreementNotActive' }))
  check(`${key}: the temporary Active copy matches the real agreement apart from its status`, () => assert.equal(r.copyMatchesAgreement, true))
  check(`${key}: control, original signature on the Active copy, is accepted`, () => assert.deepEqual(r.control, { kind: 'accepted' }))
  check(`${key}: one changed byte (${r.tamperedByte.before} -> ${r.tamperedByte.after}) is rejected with InvalidSigner`, () => assert.deepEqual(r.tampered, { kind: 'rejected', name: 'InvalidSigner' }))
  check(`${key}: overall result is "rejected"`, () => assert.equal(r.rejected, true))

  // other byte positions (r, s and v) are rejected too
  for (const index of [0, 31, 32, 63, 64]) {
    await sleep(500)
    const other = await runRejectionDemo(ctx, agreement, loaded.attestation, released.at, index)
    check(`${key}: changing byte ${index} is also rejected with InvalidSigner (control accepted)`, () => {
      assert.equal(other.control.kind, 'accepted')
      assert.deepEqual(other.tampered, { kind: 'rejected', name: 'InvalidSigner' })
    })
  }

  // honest "unavailable" paths: nothing is fabricated
  const none = await loadOriginalAttestation(ctx, agreement, undefined)
  check(`${key}: no release tx -> unavailable, not a pass`, () => assert.equal(none.ok, false))
  const wrongTx = await loadOriginalAttestation(ctx, agreement, created)
  check(`${key}: a non-release tx (the creation tx) -> unavailable: ${wrongTx.ok ? '' : wrongTx.reason}`, () => assert.equal(wrongTx.ok, false))
  const mismatch = await loadOriginalAttestation(ctx, { ...agreement, specHash: BAD_SPEC }, released.tx)
  check(`${key}: record that does not match the transaction -> unavailable`, () => assert.equal(mismatch.ok, false))
  const otherVerifier = await loadOriginalAttestation(ctx, { ...agreement, verifier: '0x0000000000000000000000000000000000000001' }, released.tx)
  check(`${key}: signature that does not recover to the verifier -> unavailable`, () => assert.equal(otherVerifier.ok, false))
}

check('tamperOneByte changes exactly one byte and keeps the length', () => {
  const sig: Hex = `0x${'ab'.repeat(65)}`
  const t = tamperOneByte(sig)
  let differing = 0
  for (let i = 0; i < 65; i++) if (t.tampered.slice(2 + i * 2, 4 + i * 2) !== sig.slice(2 + i * 2, 4 + i * 2)) differing++
  assert.equal(differing, 1); assert.equal(t.tampered.length, sig.length); assert.equal(t.index, 4)
  assert.throws(() => tamperOneByte('0x1234'))
})
console.log(`\n${passed} checks passed. Read-only: nothing was sent, signed or approved.`)
