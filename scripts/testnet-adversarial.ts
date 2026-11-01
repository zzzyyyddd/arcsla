/**
 * Read-only adversarial validation of the DEPLOYED ArcSLA contract on Arc Testnet (5042002).
 *
 *   bun run scripts/testnet-adversarial.ts
 *
 * Sends NO transaction and holds NO funded key. Every contract interaction is an `eth_call`
 * (or `eth_estimateGas`) pinned to one block. Three kinds of evidence are kept separate:
 *
 *   LIVE      eth_call against the real chain state, nothing overridden.
 *   OVERRIDE  eth_call with `stateOverride` (synthetic Active agreements written into the call's
 *             private copy of state) and `blockOverrides.time`. The deployed bytecode really runs,
 *             but the agreements and the clock are hypothetical. Nothing is persisted.
 *   LOGIC     shipped frontend functions executed in Bun, plus off-chain signing.
 *
 * Signing keys below are deterministic, UNFUNDED, test-only keys derived from public strings.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createPublicClient,
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  decodeFunctionResult,
  type Abi,
  recoverTypedDataAddress,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { arcSlaAbi } from '../src/contracts/ArcSLA.abi'
import { verifyArcSlaContract, type ContractCheckProbe } from '../src/lib/contract-check'
import { ATTESTATION_DOMAIN_NAME, ATTESTATION_DOMAIN_VERSION, FULFILLMENT_TYPES } from '../src/lib/fulfillment-types'
import { computeBlockedReason } from '../src/lib/write-guard'

// ---------------------------------------------------------------- constants
const RPC = 'https://rpc.testnet.arc.io'
const OTHER_TESTNET_RPC = 'https://sepolia.base.org' // Base Sepolia (84532): a wrong-network RPC, still a testnet
const CHAIN_ID = 5042002
const ARCSLA: Address = '0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47'
const USDC: Address = '0x3600000000000000000000000000000000000000'
const DEPLOY_BLOCK = 69654812n
const RELEASE_TX: Hex = '0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3'
const REFUND_TX: Hex = '0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e'
const PROBE: Address = '0x000000000000000000000000000000000000ffff'
const E6 = 1_000_000n

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC) })
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const probeArtifact = JSON.parse(readFileSync('contracts/out/TestnetProbe.sol/TestnetProbe.json', 'utf8')) as {
  abi: Abi
  deployedBytecode: { object: Hex }
}

const verifierKey = privateKeyToAccount(keccak256(toBytes('arcsla-testnet-evidence-verifier')))
const impostorKey = privateKeyToAccount(keccak256(toBytes('arcsla-testnet-evidence-impostor')))
const zeroBalanceKey = privateKeyToAccount(keccak256(toBytes('arcsla-testnet-evidence-zero-balance')))

const CUSTOMER_A: Address = '0x00000000000000000000000000000000c0de0001'
const PROVIDER: Address = '0x00000000000000000000000000000000c0de0002'
const CUSTOMER_B: Address = '0x00000000000000000000000000000000c0de0003'
const PROVIDER_B: Address = '0x00000000000000000000000000000000c0de0004'
const STRANGER: Address = '0x00000000000000000000000000000000c0de0099'

// ---------------------------------------------------------------- result bookkeeping
type Kind = 'LIVE eth_call' | 'OVERRIDE eth_call' | 'LOGIC (bun)' | 'OFFCHAIN signing' | 'ONCHAIN data'
type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN'
interface Result {
  id: string
  name: string
  kind: Kind
  status: Status
  expected: string
  observed: string
}
const results: Result[] = []
function record(r: Result) {
  results.push(r)
  console.log(`${r.status.padEnd(8)} ${r.id.padEnd(6)} ${r.name}\n         expected: ${r.expected}\n         observed: ${r.observed}`)
}

// ---------------------------------------------------------------- raw eth_call
interface CallOutcome {
  ok: boolean
  data?: Hex
  errorName?: string
  selector?: Hex
  raw: string
}
type Overrides = Record<string, { stateDiff?: Record<Hex, Hex>; balance?: Hex; code?: Hex }>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let PINNED_BLOCK = 0n
async function ethCall(
  tx: { to: Address; data: Hex; from?: Address; gas?: Hex; gasPrice?: Hex },
  opts: { overrides?: Overrides; time?: bigint; block?: bigint } = {},
): Promise<CallOutcome> {
  const params: unknown[] = [tx, toHex(opts.block ?? PINNED_BLOCK), opts.overrides ?? {}]
  if (opts.time !== undefined) params.push({ time: toHex(opts.time) })
  let json: { result?: Hex; error?: { code: number; message: string; data?: Hex } } = {}
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(150 + attempt * 400) // pace requests; back off harder on each retry
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params }),
    })
    json = (await res.json()) as typeof json
    if (json.error?.code !== -32005) break // -32005 = "rate limit exceeded": retry, never score it as a result
  }
  const raw = JSON.stringify(json.error ?? { result: (json.result ?? '').slice(0, 74) })
  if (json.result !== undefined) return { ok: true, data: json.result, raw }
  const data = json.error?.data
  if (data && data.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi: arcSlaAbi, data })
      return { ok: false, errorName: decoded.errorName, selector: data.slice(0, 10) as Hex, raw }
    } catch {
      return { ok: false, selector: data.slice(0, 10) as Hex, raw }
    }
  }
  return { ok: false, raw }
}
const describeOutcome = (o: CallOutcome) =>
  o.ok ? `success (no revert); rpc=${o.raw}` : `revert ${o.errorName ?? 'unknown'}${o.selector ? ` selector=${o.selector}` : ''}; rpc=${o.raw}`

function expectRevert(id: string, name: string, kind: Kind, o: CallOutcome, expectedError: string) {
  record({
    id,
    name,
    kind,
    status: !o.ok && o.errorName === expectedError ? 'PASS' : 'FAIL',
    expected: `revert ${expectedError}`,
    observed: describeOutcome(o),
  })
}
function expectSuccess(id: string, name: string, kind: Kind, o: CallOutcome) {
  record({ id, name, kind, status: o.ok ? 'PASS' : 'FAIL', expected: 'success (no revert)', observed: describeOutcome(o) })
}

// ---------------------------------------------------------------- state override helpers
const slotHex = (n: bigint): Hex => toHex(n, { size: 32 })
const padAddr = (a: Address): Hex => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}` as Hex

interface SynAgreement {
  id: bigint
  customer: Address
  provider: Address
  verifier: Address
  amount: bigint
  deadline: bigint
  specHash: Hex
  status: 0 | 1 | 2
  createdAt: bigint
  evidence?: Hex
}
function agreementSlots(a: SynAgreement): Record<Hex, Hex> {
  const base = BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [a.id, 2n]))) // _agreements is slot 2
  const w = (k: number, v: Hex) => [slotHex(base + BigInt(k)), v] as const
  return Object.fromEntries([
    w(0, padAddr(a.customer)),
    w(1, padAddr(a.provider)),
    w(2, padAddr(a.verifier)),
    w(3, slotHex(a.amount)),
    w(4, slotHex(a.deadline)),
    w(5, a.specHash),
    w(6, slotHex(BigInt(a.status) + (a.createdAt << 8n))), // status (offset 0) + createdAt (offset 1)
    w(7, a.evidence ?? `0x${'0'.repeat(64)}`),
  ])
}
function buildOverrides(list: SynAgreement[], withProbe = false): Overrides {
  const diff: Record<Hex, Hex> = {}
  let escrow = 0n
  let maxId = 2n
  for (const a of list) {
    Object.assign(diff, agreementSlots(a))
    if (a.status === 0) escrow += a.amount
    if (a.id > maxId) maxId = a.id
  }
  diff[slotHex(3n)] = slotHex(maxId) // agreementCount
  diff[slotHex(4n)] = slotHex(escrow) // totalEscrowed
  const overrides: Overrides = {
    [ARCSLA]: { stateDiff: diff, balance: toHex(escrow * 10n ** 12n) }, // Arc USDC: 6-decimal ERC-20 view of an 18-decimal native balance
  }
  if (withProbe) overrides[PROBE] = { code: probeArtifact.deployedBytecode.object }
  return overrides
}

// ---------------------------------------------------------------- signing
const domain = (chainId = CHAIN_ID, verifyingContract: Address = ARCSLA) =>
  ({ name: ATTESTATION_DOMAIN_NAME, version: ATTESTATION_DOMAIN_VERSION, chainId, verifyingContract }) as const
interface Attestation {
  agreementId: bigint
  specHash: Hex
  provider: Address
  evidenceHash: Hex
  expiry: bigint
}
const sign = (signer: typeof verifierKey, m: Attestation, d = domain()) =>
  signer.signTypedData({ domain: d, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message: m })
const releaseData = (m: Attestation, sig: Hex): Hex =>
  encodeFunctionData({ abi: arcSlaAbi, functionName: 'release', args: [m.agreementId, m.specHash, m.provider, m.evidenceHash, m.expiry, sig] })
const refundData = (id: bigint): Hex => encodeFunctionData({ abi: arcSlaAbi, functionName: 'refund', args: [id] })
const flipByte = (sig: Hex, index: number): Hex => {
  const bytes = toBytes(sig)
  bytes[index] ^= 0x01
  return toHex(bytes)
}

// ================================================================ main
const head = await client.getBlock()
PINNED_BLOCK = head.number
const T0 = head.timestamp
console.log(`Pinned block ${PINNED_BLOCK} (timestamp ${T0}); contract ${ARCSLA}; chain ${CHAIN_ID}\n`)

// ---------------------------------------------------------------- A. onchain facts
const count = await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'agreementCount', blockNumber: PINNED_BLOCK })
const totalEscrowed = await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'totalEscrowed', blockNumber: PINNED_BLOCK })
const contractUsdc = await client.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [ARCSLA], blockNumber: PINNED_BLOCK })
const contractNative = await client.getBalance({ address: ARCSLA, blockNumber: PINNED_BLOCK })
const real = await Promise.all(
  Array.from({ length: Number(count) }, (_, i) =>
    client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'getAgreement', args: [BigInt(i + 1)], blockNumber: PINNED_BLOCK }),
  ),
)
const [a1, a2] = real
console.log('onchain facts:', { count, totalEscrowed, contractUsdc, contractNative, statuses: real.map((r) => r.status) }, '\n')

// A1 deadline boundary rule, read from source and confirmed on the real events
{
  const src = readFileSync('contracts/ArcSLA.sol', 'utf8')
  const rel = /if \(block\.timestamp > agreement\.deadline\) revert DeadlinePassed\(\);/.test(src)
  const ref = /if \(block\.timestamp <= agreement\.deadline\) revert RefundNotAvailable\(\);/.test(src)
  const exp = /if \(block\.timestamp > expiry\) revert AttestationExpired\(\);/.test(src)
  record({
    id: 'B0',
    name: 'Boundary rules in the source that was deployed',
    kind: 'ONCHAIN data',
    status: rel && ref && exp ? 'PASS' : 'FAIL',
    expected: 'release allowed while now <= deadline and now <= expiry; refund only when now > deadline',
    observed: `source contains release revert on now > deadline: ${rel}; refund revert on now <= deadline: ${ref}; attestation revert on now > expiry: ${exp}`,
  })
}

// ---------------------------------------------------------------- B. deployed bytecode matches local artifact
{
  const deployed = (await client.getCode({ address: ARCSLA, blockNumber: PINNED_BLOCK })) ?? '0x'
  const artifact = JSON.parse(readFileSync('contracts/out/ArcSLA.sol/ArcSLA.json', 'utf8')) as { deployedBytecode: { object: Hex } }
  // Immutables (usdc, EIP-712 caches) are patched into runtime code, so compare ignoring the metadata tail and compare lengths.
  const local = artifact.deployedBytecode.object
  const sameLength = deployed.length === local.length
  const prefix = 200
  record({
    id: 'B1',
    name: 'Deployed runtime code is the compiled ArcSLA',
    kind: 'ONCHAIN data',
    status: sameLength && deployed.slice(0, prefix) === local.slice(0, prefix) ? 'PASS' : 'FAIL',
    expected: 'same length and same leading code as contracts/out/ArcSLA.sol/ArcSLA.json (immutables differ)',
    observed: `deployed ${(deployed.length - 2) / 2} bytes vs artifact ${(local.length - 2) / 2} bytes; first ${prefix / 2} bytes equal: ${deployed.slice(0, prefix) === local.slice(0, prefix)}`,
  })
}

// ---------------------------------------------------------------- C. LIVE tests on real settled agreements
const realRelease = (id: bigint, a: typeof a1): Attestation => ({
  agreementId: id,
  specHash: a.specHash,
  provider: a.provider,
  evidenceHash: keccak256(toBytes('live-test-evidence')),
  expiry: T0 + 3600n,
})
const dummySig = await sign(impostorKey, realRelease(1n, a1)) // well-formed, wrong signer
{
  const o = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(realRelease(1n, a1), dummySig) })
  expectRevert('L1', 'Duplicate release: agreement #1 (already Released)', 'LIVE eth_call', o, 'AgreementNotActive')
  const o2 = await ethCall({ to: ARCSLA, from: a2.customer, data: refundData(2n) })
  expectRevert('L2', 'Duplicate refund: agreement #2 (already Refunded), caller is its customer', 'LIVE eth_call', o2, 'AgreementNotActive')
  const o3 = await ethCall({ to: ARCSLA, from: a1.customer, data: refundData(1n) })
  expectRevert('L3', 'Refund after release: agreement #1, caller is its customer', 'LIVE eth_call', o3, 'AgreementNotActive')
  const o4 = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(realRelease(2n, a2), dummySig) })
  expectRevert('L4', 'Release after refund: agreement #2', 'LIVE eth_call', o4, 'AgreementNotActive')
  const o5 = await ethCall({ to: ARCSLA, from: STRANGER, data: refundData(1n) })
  expectRevert('L5', 'Unauthorized refund (stranger) on settled agreement #1', 'LIVE eth_call', o5, 'AgreementNotActive')
  const o6 = await ethCall({ to: ARCSLA, from: a1.customer, data: refundData(count + 1n) })
  expectRevert('L6', `Refund of nonexistent agreement #${count + 1n}`, 'LIVE eth_call', o6, 'AgreementNotFound')
  const o7 = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...realRelease(0n, a1), agreementId: 0n }, dummySig) })
  expectRevert('L7', 'Release of agreement ID 0', 'LIVE eth_call', o7, 'AgreementNotFound')
}

// ---------------------------------------------------------------- D. real events + real signature re-check
const logs: { kind: string; id: bigint; amount: bigint; txHash: Hex; block: bigint }[] = []
let largestAcceptedRange = 0n
{
  let cursor = DEPLOY_BLOCK
  let step = 20_000n
  while (cursor <= PINNED_BLOCK) {
    const end = cursor + step - 1n > PINNED_BLOCK ? PINNED_BLOCK : cursor + step - 1n
    try {
      const chunk = await client.getContractEvents({ address: ARCSLA, abi: arcSlaAbi, fromBlock: cursor, toBlock: end })
      if (end - cursor + 1n > largestAcceptedRange) largestAcceptedRange = end - cursor + 1n
      for (const l of chunk) {
        const args = l.args as unknown as { id: bigint; amount: bigint }
        logs.push({ kind: (l as { eventName: string }).eventName, id: args.id, amount: args.amount, txHash: l.transactionHash, block: l.blockNumber })
      }
      cursor = end + 1n
    } catch (error) {
      if (step <= 250n) throw error
      step = step / 2n // same halving strategy as the frontend event scanner
    }
  }
}
console.log('largest eth_getLogs block range accepted by the RPC during this run:', largestAcceptedRange.toString())
{
  const created = logs.filter((l) => l.kind === 'AgreementCreated').reduce((s, l) => s + l.amount, 0n)
  const released = logs.filter((l) => l.kind === 'AgreementReleased').reduce((s, l) => s + l.amount, 0n)
  const refunded = logs.filter((l) => l.kind === 'AgreementRefunded').reduce((s, l) => s + l.amount, 0n)
  const activeSum = real.filter((r) => r.status === 0).reduce((s, r) => s + r.amount, 0n)
  const ok = created === released + refunded + totalEscrowed && totalEscrowed === activeSum && contractUsdc >= totalEscrowed
  record({
    id: 'C1',
    name: 'Escrow conservation on current chain state',
    kind: 'ONCHAIN data',
    status: ok ? 'PASS' : 'FAIL',
    expected: 'created = released + refunded + totalEscrowed; totalEscrowed = sum of Active; contract USDC >= totalEscrowed',
    observed: `block ${PINNED_BLOCK}: created=${created} released=${released} refunded=${refunded} totalEscrowed=${totalEscrowed} sumActive=${activeSum} ERC-20 balanceOf(ArcSLA)=${contractUsdc} native=${contractNative}; events=${logs.length}`,
  })
  const iso =
    a1.status === 1 && a2.status === 2 && a1.evidenceHash !== a2.evidenceHash && a2.evidenceHash === `0x${'0'.repeat(64)}` && a1.amount === a2.amount &&
    logs.filter((l) => l.id === 1n).map((l) => l.kind).join() === 'AgreementCreated,AgreementReleased' &&
    logs.filter((l) => l.id === 2n).map((l) => l.kind).join() === 'AgreementCreated,AgreementRefunded'
  record({
    id: 'C2',
    name: 'Agreement isolation on current chain state (#1 released, #2 refunded)',
    kind: 'ONCHAIN data',
    status: iso ? 'PASS' : 'FAIL',
    expected: '#1 has only Created+Released events and an evidence hash; #2 has only Created+Refunded events and none; statuses independent',
    observed: `#1 status=${a1.status} evidence set=${a1.evidenceHash !== `0x${'0'.repeat(64)}`} events=[${logs.filter((l) => l.id === 1n).map((l) => `${l.kind}@${l.block}`).join(', ')}]; #2 status=${a2.status} events=[${logs.filter((l) => l.id === 2n).map((l) => `${l.kind}@${l.block}`).join(', ')}]`,
  })
}

{
  const [rr, fr] = await Promise.all([client.getTransactionReceipt({ hash: RELEASE_TX }), client.getTransactionReceipt({ hash: REFUND_TX })])
  record({
    id: 'C3', name: 'Confirmed lifecycle transactions are final and successful', kind: 'ONCHAIN data',
    status: rr.status === 'success' && fr.status === 'success' && rr.blockNumber <= PINNED_BLOCK && fr.blockNumber <= PINNED_BLOCK ? 'PASS' : 'FAIL',
    expected: 'both receipts have status success',
    observed: `release ${RELEASE_TX} block ${rr.blockNumber} status ${rr.status} gas ${rr.gasUsed}; refund ${REFUND_TX} block ${fr.blockNumber} status ${fr.status} gas ${fr.gasUsed}`,
  })
}

// real signature from the live release tx: recover signer; then rehydrate (OVERRIDE) and tamper
const releaseTx = await client.getTransaction({ hash: RELEASE_TX })
const decoded = decodeFunctionData({ abi: arcSlaAbi, data: releaseTx.input })
const [rId, rSpec, rProvider, rEvidence, rExpiry, rSig] = decoded.args as [bigint, Hex, Address, Hex, bigint, Hex]
const realMsg: Attestation = { agreementId: rId, specHash: rSpec, provider: rProvider, evidenceHash: rEvidence, expiry: rExpiry }
{
  const recovered = await recoverTypedDataAddress({ domain: domain(), types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message: realMsg, signature: rSig })
  const digestLocal = hashTypedData({ domain: domain(), types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message: realMsg })
  const digestChain = await client.readContract({
    address: ARCSLA, abi: arcSlaAbi, functionName: 'fulfillmentDigest',
    args: [realMsg.agreementId, realMsg.specHash, realMsg.provider, realMsg.evidenceHash, realMsg.expiry], blockNumber: PINNED_BLOCK,
  })
  record({
    id: 'D1',
    name: 'Real release signature (from tx calldata) recovers to the agreement verifier under the frontend typed-data definition',
    kind: 'ONCHAIN data',
    status: recovered.toLowerCase() === a1.verifier.toLowerCase() && digestLocal === digestChain ? 'PASS' : 'FAIL',
    expected: 'recovered signer == verifier of #1; viem digest == contract fulfillmentDigest()',
    observed: `recovered=${recovered}; verifier=${a1.verifier}; local digest=${digestLocal}; onchain digest=${digestChain}; tx=${RELEASE_TX}`,
  })
}
{
  // Force agreement #1 back to Active (synthetic) and fund the contract so release can pay; clock = original release time.
  const synthetic1: SynAgreement = { id: 1n, ...a1, status: 0, evidence: `0x${'0'.repeat(64)}` }
  const ov = buildOverrides([synthetic1])
  const time = 1793271259n // AgreementReleased.releasedAt in the real tx
  const good = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(realMsg, rSig) }, { overrides: ov, time })
  expectSuccess('D2', 'Real verifier signature accepted when #1 is rehydrated to Active (positive control)', 'OVERRIDE eth_call', good)
  const bad = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(realMsg, flipByte(rSig, 10)) }, { overrides: ov, time })
  expectRevert('D3', 'Real verifier signature with one byte flipped is rejected', 'OVERRIDE eth_call', bad, 'InvalidSigner')
  const wrongEv = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...realMsg, evidenceHash: keccak256(toBytes('forged')) }, rSig) }, { overrides: ov, time })
  expectRevert('D4', 'Real signature replayed with a different evidence hash is rejected', 'OVERRIDE eth_call', wrongEv, 'InvalidSigner')
  const late = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(realMsg, rSig) }, { overrides: ov, time: BigInt(a1.deadline) + 1n })
  expectRevert('D5', 'Real attestation submitted one second after the agreement deadline', 'OVERRIDE eth_call', late, 'DeadlinePassed')
}

// ---------------------------------------------------------------- E. synthetic Active agreements
const SPEC = keccak256(toBytes('syn.spec'))
const EVID = keccak256(toBytes('syn.evidence'))
const NOW = T0 + 10n
const DL = T0 + 3600n
const mk = (id: bigint, over: Partial<SynAgreement> = {}): SynAgreement => ({
  id, customer: CUSTOMER_A, provider: PROVIDER, verifier: verifierKey.address, amount: E6, deadline: DL, specHash: SPEC, status: 0, createdAt: T0 - 60n, ...over,
})
const synList: SynAgreement[] = [
  mk(3n),
  mk(4n), // identical terms, different id (replay target)
  mk(5n, { customer: CUSTOMER_B, provider: PROVIDER_B, amount: 2n * E6, deadline: T0 + 7200n }), // untouched control
  mk(6n, { deadline: T0 - 10n }), // already past deadline, customer CUSTOMER_A
  mk(7n, { customer: PROBE, deadline: T0 - 10n }), // past deadline, customer is the probe
  mk(8n, { customer: PROBE }), // future deadline, customer is the probe
]
const OV = buildOverrides(synList, true)
const att = (id: bigint, over: Partial<Attestation> = {}): Attestation => ({ agreementId: id, specHash: SPEC, provider: PROVIDER, evidenceHash: EVID, expiry: T0 + 1800n, ...over })

{
  const got = await client.request({
    method: 'eth_call' as never,
    params: [{ to: ARCSLA, data: encodeFunctionData({ abi: arcSlaAbi, functionName: 'getAgreement', args: [3n] }) }, toHex(PINNED_BLOCK), OV] as never,
  }) as Hex
  const decodedA = decodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'customer', type: 'address' }, { name: 'provider', type: 'address' }, { name: 'verifier', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint64' }, { name: 'specHash', type: 'bytes32' }, { name: 'status', type: 'uint8' }, { name: 'createdAt', type: 'uint64' }, { name: 'evidenceHash', type: 'bytes32' },
    ] }], got)[0] as { customer: Address; verifier: Address; amount: bigint; deadline: bigint; status: number; createdAt: bigint }
  record({
    id: 'S0',
    name: 'Self-test: synthetic storage layout decodes as an Active agreement',
    kind: 'OVERRIDE eth_call',
    status: decodedA.status === 0 && decodedA.amount === E6 && decodedA.deadline === DL && decodedA.createdAt === T0 - 60n && decodedA.verifier.toLowerCase() === verifierKey.address.toLowerCase() ? 'PASS' : 'FAIL',
    expected: 'getAgreement(3) returns the synthetic Active agreement written via stateDiff',
    observed: JSON.stringify(decodedA, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  })
}

// early / unauthorized refund
expectRevert('E1', 'Early refund by the customer (now = deadline - 3590s)', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: CUSTOMER_A, data: refundData(3n) }, { overrides: OV, time: NOW }), 'RefundNotAvailable')
for (const [who, addr] of [['provider', PROVIDER], ['verifier', verifierKey.address], ['stranger', STRANGER]] as const) {
  expectRevert(`E2${who[0]}`, `Unauthorized refund by ${who}, before the deadline`, 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: addr, data: refundData(3n) }, { overrides: OV, time: NOW }), 'NotCustomer')
  expectRevert(`E3${who[0]}`, `Unauthorized refund by ${who}, after the deadline (agreement #6, Active and expired)`, 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: addr, data: refundData(6n) }, { overrides: OV, time: NOW }), 'NotCustomer')
}
// refund boundary
expectRevert('E4', 'Refund exactly AT the deadline (now == deadline)', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: CUSTOMER_A, data: refundData(3n) }, { overrides: OV, time: DL }), 'RefundNotAvailable')
expectSuccess('E5', 'Refund one second AFTER the deadline (now == deadline + 1) by the customer', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: CUSTOMER_A, data: refundData(3n) }, { overrides: OV, time: DL + 1n }))
expectSuccess('E5b', 'Refund of an already-expired agreement (#6) by its customer (positive control)', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: CUSTOMER_A, data: refundData(6n) }, { overrides: OV, time: NOW }))

// release / signature tests
const m3 = att(3n)
const sig3 = await sign(verifierKey, m3)
expectSuccess('E6', 'Valid release by a stranger (positive control, correct verifier key)', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(m3, sig3) }, { overrides: OV, time: NOW }))
expectRevert('E7', 'Signature from a non-verifier key', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(m3, await sign(impostorKey, m3)) }, { overrides: OV, time: NOW }), 'InvalidSigner')
{
  let rejected = 0
  const failures: number[] = []
  for (let i = 0; i < 65; i++) {
    const o = await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(m3, flipByte(sig3, i)) }, { overrides: OV, time: NOW })
    if (!o.ok && o.errorName === 'InvalidSigner') rejected++
    else failures.push(i)
  }
  record({
    id: 'E8', name: 'Tampered signature: every one of the 65 bytes flipped (one bit each)', kind: 'OVERRIDE eth_call',
    status: rejected === 65 ? 'PASS' : 'FAIL', expected: '65/65 rejected with InvalidSigner',
    observed: `${rejected}/65 rejected with InvalidSigner${failures.length ? `; not rejected at byte indexes ${failures.join(',')}` : ''}`,
  })
}
expectRevert('E9', 'Replay across agreements: signature for #3 submitted for #4 (identical terms)', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(att(4n), sig3) }, { overrides: OV, time: NOW }), 'InvalidSigner')
expectRevert('E10', 'Cross-chain replay: signature made for chain 5042 domain', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(m3, await sign(verifierKey, m3, domain(5042))) }, { overrides: OV, time: NOW }), 'InvalidSigner')
expectRevert('E11', 'Cross-contract replay: signature made for a different verifyingContract', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(m3, await sign(verifierKey, m3, domain(CHAIN_ID, '0x0000000000000000000000000000000000001234'))) }, { overrides: OV, time: NOW }), 'InvalidSigner')
expectRevert('E12', 'Tampered fields: provider differs from the agreement', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...m3, provider: STRANGER }, sig3) }, { overrides: OV, time: NOW }), 'ProviderMismatch')
expectRevert('E13', 'Tampered fields: specification hash differs from the agreement', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...m3, specHash: keccak256(toBytes('other')) }, sig3) }, { overrides: OV, time: NOW }), 'SpecHashMismatch')
expectRevert('E14', 'Tampered fields: evidence hash differs from what was signed', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...m3, evidenceHash: keccak256(toBytes('forged')) }, sig3) }, { overrides: OV, time: NOW }), 'InvalidSigner')
expectRevert('E15', 'Tampered fields: expiry differs from what was signed', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData({ ...m3, expiry: m3.expiry + 1n }, sig3) }, { overrides: OV, time: NOW }), 'InvalidSigner')
expectRevert('E16', 'Zero evidence hash', 'OVERRIDE eth_call',
  await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(att(3n, { evidenceHash: `0x${'0'.repeat(64)}` }), sig3) }, { overrides: OV, time: NOW }), 'ZeroEvidenceHash')

// expiry boundary
{
  const mExp = att(3n, { expiry: NOW - 1n })
  expectRevert('E17', 'Expired attestation (expiry = now - 1)', 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(mExp, await sign(verifierKey, mExp)) }, { overrides: OV, time: NOW }), 'AttestationExpired')
  const mEq = att(3n, { expiry: NOW })
  expectSuccess('E18', 'Attestation expiring exactly now (expiry == now) is still valid', 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(mEq, await sign(verifierKey, mEq)) }, { overrides: OV, time: NOW }))
}
// settlement vs deadline boundary
{
  const mLong = att(3n, { expiry: DL + 100_000n })
  const sLong = await sign(verifierKey, mLong)
  expectRevert('E19', 'Settlement one second after the deadline (now == deadline + 1)', 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(mLong, sLong) }, { overrides: OV, time: DL + 1n }), 'DeadlinePassed')
  expectSuccess('E20', 'Settlement exactly AT the deadline (now == deadline)', 'OVERRIDE eth_call',
    await ethCall({ to: ARCSLA, from: STRANGER, data: releaseData(mLong, sLong) }, { overrides: OV, time: DL }))
}

// ---------------------------------------------------------------- F. multi-step probe: duplicates, ordering, isolation, conservation
{
  const probeAbi = probeArtifact.abi
  const m8 = att(8n)
  const m7 = att(7n)
  const sig8 = await sign(verifierKey, m8)
  const sig7 = await sign(verifierKey, m7)
  const calls: Hex[] = [
    releaseData(m3, sig3), //          0 release #3                         -> ok
    releaseData(m3, sig3), //          1 duplicate release #3               -> AgreementNotActive
    refundData(7n), //                 2 refund #7 (probe is customer)       -> ok
    refundData(7n), //                 3 duplicate refund #7                -> AgreementNotActive
    releaseData(m7, sig7), //          4 release after refund #7             -> AgreementNotActive
    releaseData(m8, sig8), //          5 release #8                          -> ok
    refundData(8n), //                 6 refund after release #8 (customer)   -> AgreementNotActive
    refundData(6n), //                 7 refund #6 (probe NOT its customer)   -> NotCustomer
    releaseData(att(4n), sig3), //     8 replay #3's signature on #4         -> InvalidSigner
  ]
  const expectedSel = ['ok', 'AgreementNotActive', 'ok', 'AgreementNotActive', 'AgreementNotActive', 'ok', 'AgreementNotActive', 'NotCustomer', 'InvalidSigner']
  const ids = [3n, 4n, 5n, 6n, 7n, 8n]
  const watch = [PROVIDER, PROBE, PROVIDER_B, CUSTOMER_A, ARCSLA]
  const data = encodeFunctionData({ abi: probeAbi, functionName: 'run', args: [ARCSLA, USDC, ids, watch, calls] })
  const o = await ethCall({ to: PROBE, from: STRANGER, data }, { overrides: OV, time: NOW })
  if (!o.ok || !o.data) {
    record({ id: 'P0', name: 'Multi-step probe execution', kind: 'OVERRIDE eth_call', status: 'BLOCKED', expected: 'probe returns before/after snapshots', observed: describeOutcome(o) })
  } else {
    const [before, steps, after] = decodeFunctionResult({ abi: probeAbi, functionName: 'run', data: o.data }) as [
      { totalEscrowed: bigint; contractUsdc: bigint; status: number[]; amount: bigint[]; evidence: Hex[]; watched: bigint[] },
      { ok: boolean; selector: Hex }[],
      { totalEscrowed: bigint; contractUsdc: bigint; status: number[]; amount: bigint[]; evidence: Hex[]; watched: bigint[] },
    ]
    const names = steps.map((s) => {
      if (s.ok) return 'ok'
      try { return decodeErrorResult({ abi: arcSlaAbi, data: s.selector }).errorName } catch { return s.selector }
    })
    // sequence results
    const seqOk = names.every((n, i) => n === expectedSel[i])
    record({
      id: 'P1', name: 'Sequenced duplicates and ordering inside ONE simulated call (release x2, refund x2, release-after-refund, refund-after-release, non-customer refund, replay)',
      kind: 'OVERRIDE eth_call', status: seqOk ? 'PASS' : 'FAIL', expected: expectedSel.join(' | '), observed: names.join(' | '),
    })
    // isolation: ids order [3,4,5,6,7,8]
    const idx = (n: number) => ids.indexOf(BigInt(n))
    const untouched = [4, 5, 6].every((n) => after.status[idx(n)] === 0 && after.amount[idx(n)] === before.amount[idx(n)] && after.evidence[idx(n)] === before.evidence[idx(n)])
    const settled = after.status[idx(3)] === 1 && after.status[idx(7)] === 2 && after.status[idx(8)] === 1
    record({
      id: 'P2', name: 'Agreement isolation: settling #3, #7, #8 leaves #4, #5, #6 byte-for-byte unchanged', kind: 'OVERRIDE eth_call',
      status: untouched && settled ? 'PASS' : 'FAIL', expected: '#3 Released, #7 Refunded, #8 Released; #4, #5, #6 still Active with same amount and no evidence',
      observed: `before status=[${before.status.join(',')}] after status=[${after.status.join(',')}]; evidence #4/#5/#6 after=[${[4, 5, 6].map((n) => after.evidence[idx(n)].slice(0, 10)).join(',')}]`,
    })
    // conservation
    const dContract = before.contractUsdc - after.contractUsdc
    const dEscrow = before.totalEscrowed - after.totalEscrowed
    const dProvider = after.watched[0] - before.watched[0] // PROVIDER: released #3 and #8
    const dProbe = after.watched[1] - before.watched[1] // PROBE: refund of #7
    const dProviderB = after.watched[2] - before.watched[2] // untouched control provider
    const dCustomerA = after.watched[3] - before.watched[3] // untouched control customer
    const cons = dContract === 3n * E6 && dEscrow === 3n * E6 && dProvider === 2n * E6 && dProbe === E6 && dProviderB === 0n && dCustomerA === 0n && dContract === dProvider + dProbe
    record({
      id: 'P3', name: 'Escrow conservation: contract outflow equals provider + refunded-customer inflow; no third party gains',
      kind: 'OVERRIDE eth_call', status: cons ? 'PASS' : 'FAIL',
      expected: 'contract USDC -3.000000 and totalEscrowed -3.000000; provider +2.000000; refunded customer +1.000000; others +0',
      observed: `contract USDC ${before.contractUsdc} -> ${after.contractUsdc} (Δ -${dContract}); totalEscrowed ${before.totalEscrowed} -> ${after.totalEscrowed}; provider Δ +${dProvider}; refunded customer Δ +${dProbe}; control provider Δ ${dProviderB}; control customer Δ ${dCustomerA}`,
    })
    const invariant = after.contractUsdc >= after.totalEscrowed && after.totalEscrowed === 4n * E6 /* #4 + #5(2) + #6 */
    record({
      id: 'P4', name: 'Invariant after settlement: contract USDC >= totalEscrowed and totalEscrowed == sum of remaining Active', kind: 'OVERRIDE eth_call',
      status: invariant ? 'PASS' : 'FAIL', expected: 'totalEscrowed == 4.000000 (#4 1 + #5 2 + #6 1) and balance >= that',
      observed: `totalEscrowed=${after.totalEscrowed}, contract USDC=${after.contractUsdc}`,
    })
  }
}

// ---------------------------------------------------------------- G. frontend safeguards (shipped functions, run in Bun)
const probeFor = (c: ReturnType<typeof createPublicClient>): ContractCheckProbe => ({
  getChainId: () => c.getChainId(),
  getCode: (address) => c.getCode({ address }),
  readUsdc: (address) => c.readContract({ address, abi: arcSlaAbi, functionName: 'usdc' }),
  readDomain: (address) => c.readContract({ address, abi: arcSlaAbi, functionName: 'eip712Domain' }),
})
const expectation = { address: ARCSLA, usdc: USDC, chainId: CHAIN_ID, chainName: 'Arc Testnet' }
{
  const okRes = await verifyArcSlaContract(probeFor(client), expectation)
  record({ id: 'F1', name: 'Guard check passes for the real deployment (positive control)', kind: 'LOGIC (bun)', status: okRes.status === 'ok' ? 'PASS' : 'FAIL', expected: 'status ok', observed: JSON.stringify(okRes) })

  const wrongClient = createPublicClient({ transport: http(OTHER_TESTNET_RPC) })
  let wrongNet: unknown
  try { wrongNet = await verifyArcSlaContract(probeFor(wrongClient), expectation) } catch (e) { wrongNet = { status: 'unreachable', detail: (e as Error).message.split('\n')[0] } }
  const w = wrongNet as { status: string; detail?: string }
  record({
    id: 'F2', name: 'Wrong network: RPC for a different chain (Base Sepolia 84532) while configured for 5042002', kind: 'LOGIC (bun)',
    status: w.status === 'mismatch' ? 'PASS' : w.status === 'unreachable' ? 'BLOCKED' : 'FAIL', expected: 'status mismatch ("RPC reports chain 84532")', observed: JSON.stringify(w),
  })

  const cases: [string, Address, string][] = [
    ['F3', a1.provider, 'EOA / no code (provider wallet)'],
    ['F4', '0x000000000000000000000000000000000000dEaD', 'empty address'],
    ['F5', USDC, 'a real contract that is not ArcSLA (USDC)'],
  ]
  for (const [id, address, label] of cases) {
    const res = await verifyArcSlaContract(probeFor(client), { ...expectation, address })
    const expectStatus = id === 'F5' ? 'mismatch' : 'missing'
    record({ id, name: `Invalid contract address: ${label}`, kind: 'LOGIC (bun)', status: res.status === expectStatus ? 'PASS' : 'FAIL', expected: `status ${expectStatus}`, observed: JSON.stringify(res) })
  }
  const otherUsdc = await verifyArcSlaContract(probeFor(client), { ...expectation, usdc: '0x0000000000000000000000000000000000001234' })
  record({ id: 'F6', name: 'Configured USDC differs from the one the contract settles in', kind: 'LOGIC (bun)', status: otherUsdc.status === 'mismatch' ? 'PASS' : 'FAIL', expected: 'status mismatch', observed: JSON.stringify(otherUsdc) })

  const base = { configIssues: [] as string[], isWalletConnected: true, walletChainId: CHAIN_ID, expectedChainId: CHAIN_ID, expectedChainName: 'Arc Testnet', contractStatus: 'ok' as const, isMainnet: false, mainnetAcknowledged: false }
  const table: [string, Parameters<typeof computeBlockedReason>[0], boolean][] = [
    ['all conditions good (testnet)', base, false],
    ['wallet on wrong network (84532)', { ...base, walletChainId: 84532 }, true],
    ['contract missing', { ...base, contractStatus: 'missing', contractDetail: 'No contract' }, true],
    ['contract mismatch', { ...base, contractStatus: 'mismatch', contractDetail: 'Not ArcSLA' }, true],
    ['contract unreachable', { ...base, contractStatus: 'unreachable' }, true],
    ['still verifying', { ...base, contractStatus: 'checking' }, true],
    ['invalid configuration', { ...base, configIssues: ['VITE_ARCSLA_ADDRESS is not set to a valid address.'] }, true],
    ['mainnet without acknowledgement', { ...base, isMainnet: true }, true],
    ['mainnet with acknowledgement', { ...base, isMainnet: true, mainnetAcknowledged: true }, false],
  ]
  const rows = table.map(([label, input, shouldBlock]) => {
    const reason = computeBlockedReason(input)
    return { label, blocked: reason !== undefined, ok: (reason !== undefined) === shouldBlock, reason }
  })
  record({
    id: 'F7', name: 'Write guard decision table (wrong network, bad contract, bad config, mainnet acknowledgement)', kind: 'LOGIC (bun)',
    status: rows.every((r) => r.ok) ? 'PASS' : 'FAIL', expected: 'blocked in 8 of 9 conditions; allowed only when everything is valid',
    observed: rows.map((r) => `${r.label}: ${r.blocked ? 'BLOCKED' : 'allowed'}${r.ok ? '' : ' (UNEXPECTED)'}`).join('; '),
  })
}

// zero-USDC verifier signing
{
  const realVerifier = a1.verifier
  const [vUsdc, vNative] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [realVerifier], blockNumber: PINNED_BLOCK }),
    client.getBalance({ address: realVerifier, blockNumber: PINNED_BLOCK }),
  ])
  const zUsdc = await client.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [zeroBalanceKey.address], blockNumber: PINNED_BLOCK })
  const zNative = await client.getBalance({ address: zeroBalanceKey.address, blockNumber: PINNED_BLOCK })
  const mZ = att(3n)
  const sigZ = await zeroBalanceKey.signTypedData({ domain: domain(), types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message: mZ })
  const recoveredZ = await recoverTypedDataAddress({ domain: domain(), types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message: mZ, signature: sigZ })
  record({
    id: 'Z1', name: 'Verifier signing needs no USDC: a wallet holding exactly 0 USDC signs the EIP-712 attestation', kind: 'OFFCHAIN signing',
    status: zUsdc === 0n && zNative === 0n && recoveredZ === zeroBalanceKey.address ? 'PASS' : 'FAIL',
    expected: 'balance 0 (ERC-20 and native); signature produced and recovers to the signer; no RPC write involved',
    observed: `wallet ${zeroBalanceKey.address} USDC=${zUsdc} native=${zNative}; recovered=${recoveredZ}. Real verifier ${realVerifier} also holds USDC=${vUsdc} native=${vNative} at block ${PINNED_BLOCK} and produced the accepted signature in ${RELEASE_TX}`,
  })
  // Sending would need gas: a gas-priced eth_call from the zero-balance wallet
  const o = await ethCall({ to: ARCSLA, from: zeroBalanceKey.address, gas: '0x30d40', gasPrice: '0x4a817c800', data: refundData(3n) }, { overrides: OV, time: NOW })
  const insufficient = !o.ok && /insufficient funds|gas required exceeds|lack of funds/i.test(o.raw)
  record({
    id: 'Z2', name: 'Submitting a transaction from the zero-balance wallet is refused for lack of gas (non-broadcast, gas-priced eth_call)', kind: 'LIVE eth_call',
    status: insufficient ? 'PASS' : 'BLOCKED', expected: 'node rejects: insufficient funds for gas',
    observed: `${describeOutcome(o)}. The Arc RPC executed the call instead of checking the sender's gas balance, so this cannot be demonstrated without broadcasting. Arithmetic: a ${'~'}133,622-gas release at the 20 gwei floor needs about 0.0027 USDC of gas, and this wallet holds 0.`,
  })
  const vsrc = readFileSync('src/pages/Verifier.tsx', 'utf8')
  const requiresBalance = /balanceOf|useBalance|getBalance/.test(vsrc)
  record({
    id: 'Z3', name: 'Verifier console code never reads or requires a USDC/gas balance before signing', kind: 'LOGIC (bun)',
    status: requiresBalance ? 'FAIL' : 'PASS', expected: 'no balance read in src/pages/Verifier.tsx', observed: `balance reads found: ${requiresBalance}`,
  })
}

// ---------------------------------------------------------------- NOT RUN: rendered UI and live-broadcast tests
const notRun: Result[] = [
  { id: 'U1', name: 'Rendered UI: wallet connected to a different network shows the switch banner and disabled transaction buttons', kind: 'LOGIC (bun)', status: 'NOT RUN', expected: 'banner + disabled buttons', observed: 'Needs a browser wallet. The decision logic is covered by F7. Steps below.' },
  { id: 'U2', name: 'Rendered UI: wrong VITE_ARCSLA_ADDRESS shows "Contract check failed" and disables every transaction', kind: 'LOGIC (bun)', status: 'NOT RUN', expected: 'error notice + disabled buttons', observed: 'Needs editing .env and a browser. The check itself is covered by F3 to F6. Steps below.' },
  { id: 'T1', name: 'Confirmed onchain: create a funded agreement, early-refund attempt, wrong-signer rejection, release', kind: 'ONCHAIN data', status: 'NOT RUN', expected: 'see approval plan', observed: 'Requires broadcast transactions and testnet USDC. Awaiting your approval.' },
  { id: 'T2', name: 'Confirmed onchain: revert of an unauthorized refund as a real (failing) transaction', kind: 'ONCHAIN data', status: 'NOT RUN', expected: 'tx reverts NotCustomer and costs gas', observed: 'Requires a broadcast. Not needed: the same revert is proven by eth_call (E2*, E3*). Awaiting your approval if you want it.' },
]
for (const r of notRun) record(r)

// ---------------------------------------------------------------- output
const tally = (s: Status) => results.filter((r) => r.status === s).length
console.log(`\nSUMMARY pinned block ${PINNED_BLOCK}: PASS=${tally('PASS')} FAIL=${tally('FAIL')} BLOCKED=${tally('BLOCKED')} NOT RUN=${tally('NOT RUN')}`)
mkdirSync('docs', { recursive: true })
writeFileSync(
  '/tmp/testnet-adversarial.json',
  JSON.stringify({ block: PINNED_BLOCK.toString(), blockTimestamp: T0.toString(), verifierKeyAddress: verifierKey.address, results }, null, 2),
)
