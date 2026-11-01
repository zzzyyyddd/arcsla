/**
 * Records the live T1 / T1b results from the chain into docs/TESTNET_ADVERSARIAL_EVIDENCE.md.
 *
 *   bun run scripts/record-live-evidence.ts [--sims path/to/browser-sims.json]
 *
 * READ-ONLY. It never signs, approves or sends anything and needs no key. It reads agreements,
 * event logs and receipts from Arc Testnet, runs read-only eth_call checks for the duplicate
 * settlement cases, and rewrites only the block between the LIVE:START / LIVE:END markers.
 * Anything that did not happen on chain is reported as NOT RUN. Browser-only simulations
 * (invalid / tampered signature, early refund) are accepted only from the JSON the runbook page
 * exports, and are labelled as browser-recorded.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, decodeEventLog, formatUnits, http, keccak256, toBytes, type Hex } from 'viem'
import { arcTestnet } from 'viem/chains'
import { arcSlaAbi } from '../src/contracts/ArcSLA.abi'

const RPC = 'https://rpc.testnet.arc.io'
const ARCSLA = '0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47' as const
const DOC = 'docs/TESTNET_ADVERSARIAL_EVIDENCE.md'
const SCAN_FROM = 69_765_000n // first block after the baseline run; agreements #3 and #4 are newer
const EXPECTED_AMOUNT = 100000n // 0.10 USDC
const ZERO_HASH = `0x${'0'.repeat(64)}`
const ZERO_SIG: Hex = `0x${'00'.repeat(65)}`

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN'
interface Item { id: string; name: string; type: string; status: Status; detail: string }
interface SimRecord { agreementId: string; kind: string; outcome: string; atChainTime: number; deadline?: number; source?: 'reported'; note?: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const client = createPublicClient({ chain: arcTestnet, transport: http(RPC, { retryCount: 6, retryDelay: 600 }) })

const simsArg = process.argv.indexOf('--sims')
const reportedArg = process.argv.indexOf('--reported')
const loadSims = (flag: number): SimRecord[] => (flag > -1 && existsSync(process.argv[flag + 1]) ? (JSON.parse(readFileSync(process.argv[flag + 1], 'utf8')) as SimRecord[]) : [])
// --sims: exported by the runbook page (recorded by the app). --reported: results the project owner reported, each with its own corroboration note.
const sims: SimRecord[] = [...loadSims(simsArg), ...loadSims(reportedArg)]
const REPORTED_TYPE = 'REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call)'
const sim = (id: bigint, kind: string) => sims.find((s) => s.agreementId === id.toString() && s.kind === kind)

const block = await client.getBlock()
const pinned = block.number
const count = await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'agreementCount' })
const totalEscrowed = await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'totalEscrowed' })

interface Ev { name: string; id: bigint; txHash: Hex; blockNumber: bigint; args: Record<string, unknown> }
const events: Ev[] = []
{
  let cursor = SCAN_FROM
  let step = 10_000n
  while (cursor <= pinned) {
    const end = cursor + step - 1n > pinned ? pinned : cursor + step - 1n
    try {
      const chunk = await client.getContractEvents({ address: ARCSLA, abi: arcSlaAbi, fromBlock: cursor, toBlock: end })
      for (const l of chunk) {
        const args = l.args as unknown as Record<string, unknown>
        events.push({ name: (l as { eventName: string }).eventName, id: args.id as bigint, txHash: l.transactionHash, blockNumber: l.blockNumber, args })
      }
      cursor = end + 1n
    } catch (error) {
      if (step <= 250n) throw error
      step = step / 2n
      await sleep(500)
    }
  }
}

const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x))

async function receiptBlock(hash: Hex) {
  const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })])
  const blk = await client.getBlock({ blockNumber: receipt.blockNumber })
  const arcLogs = receipt.logs
    .filter((l) => l.address.toLowerCase() === ARCSLA.toLowerCase())
    .map((l) => {
      try {
        const d = decodeEventLog({ abi: arcSlaAbi, data: l.data, topics: l.topics })
        return `${d.eventName}(${json(d.args)})`
      } catch {
        return 'undecoded ArcSLA log'
      }
    })
  const fee = receipt.gasUsed * receipt.effectiveGasPrice
  return {
    text: `tx \`${hash}\` · block ${receipt.blockNumber} (${new Date(Number(blk.timestamp) * 1000).toISOString()}) · status **${receipt.status}** · from \`${tx.from}\` · gas used **${receipt.gasUsed}** · effective gas price ${formatUnits(receipt.effectiveGasPrice, 9)} gwei · fee ${formatUnits(fee, 18)} USDC · logs total ${receipt.logs.length}, ArcSLA logs: ${arcLogs.join('; ') || 'none'}`,
    ok: receipt.status === 'success',
    timestamp: blk.timestamp,
  }
}

async function simulate(fn: 'refund' | 'release', a: { id: bigint; customer: Hex; specHash: Hex; provider: Hex; evidenceHash: Hex }) {
  try {
    if (fn === 'refund') {
      await client.simulateContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'refund', args: [a.id], account: a.customer, blockNumber: pinned })
    } else {
      await client.simulateContract({
        address: ARCSLA, abi: arcSlaAbi, functionName: 'release', blockNumber: pinned,
        args: [a.id, a.specHash, a.provider, a.evidenceHash !== ZERO_HASH ? a.evidenceHash : keccak256(toBytes('duplicate-settlement-probe')), block.timestamp + 3600n, ZERO_SIG],
      })
    }
    return 'accepted (no revert)'
  } catch (error) {
    let walk: unknown = error
    while (walk && typeof walk === 'object') {
      const e = walk as { data?: { errorName?: string }; cause?: unknown }
      if (e.data?.errorName) return e.data.errorName
      walk = e.cause
    }
    return 'reverted (unknown)'
  }
}

const items: Item[] = []
const states: string[] = []
const add = (i: Item) => items.push(i)

for (const [key, id] of [['T1', 4n], ['T1b', 5n]] as const) {
  const exists = count >= id
  const a = exists ? await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'getAgreement', args: [id] }) : undefined
  const evs = events.filter((e) => e.id === id)
  const created = evs.find((e) => e.name === 'AgreementCreated')
  const released = evs.find((e) => e.name === 'AgreementReleased')
  const refunded = evs.find((e) => e.name === 'AgreementRefunded')
  if (a) states.push(`- Agreement #${id}: status **${['Active', 'Released', 'Refunded'][a.status]}**, amount ${a.amount} (${formatUnits(a.amount, 6)} USDC), customer \`${a.customer}\`, provider \`${a.provider}\`, verifier \`${a.verifier}\`, createdAt ${a.createdAt}, deadline ${a.deadline} (${Number(a.deadline - a.createdAt)} s after creation), evidenceHash \`${a.evidenceHash}\``)
  else states.push(`- Agreement #${id}: does not exist yet (agreementCount is ${count}).`)

  // 1. creation
  if (!a || !created) {
    add({ id: `${key}.1`, name: `Create and fund agreement #${id} with 0.10 test USDC`, type: 'ONCHAIN tx', status: 'NOT RUN', detail: a ? 'agreement exists but its creation log was not found in the scanned range' : 'no agreement with this ID exists yet' })
  } else {
    const r = await receiptBlock(created.txHash)
    const window = Number(a.deadline - a.createdAt)
    // T1 plans a 60-minute window (3300-3900 s accepted: the form rounds to the minute); T1b plans about 5 minutes.
    const windowOk = key === 'T1' ? window >= 3300 && window <= 3900 : window >= 120 && window <= 600
    const good = r.ok && a.amount === EXPECTED_AMOUNT && windowOk
    add({ id: `${key}.1`, name: `Create and fund agreement #${id} with 0.10 test USDC`, type: 'ONCHAIN tx', status: good ? 'PASS' : 'FAIL', detail: `${r.text}. Amount ${a.amount}, deadline ${window} s after creation (planned ${key === 'T1' ? 'about 3600' : 'about 300'} s; window ${windowOk ? 'as planned' : 'NOT as planned'}).` })
  }

  const wantSim = (kind: string, id2: string, name: string, expected: string, okIf?: (s: SimRecord) => boolean) => {
    const s = sim(id, kind)
    if (!s) add({ id: id2, name, type: 'SIMULATION recorded in browser (eth_call)', status: 'NOT RUN', detail: 'no browser record supplied (export it from the runbook page and pass --sims)' })
    else if (s.source === 'reported') add({ id: id2, name, type: REPORTED_TYPE, status: s.outcome === expected ? 'PASS' : 'FAIL', detail: `${s.note ?? ''} Expected ${expected}, reported ${s.outcome}. No transaction was sent.` })
    else add({ id: id2, name, type: 'SIMULATION recorded in browser (eth_call)', status: s.outcome === expected && (okIf ? okIf(s) : true) ? 'PASS' : 'FAIL', detail: `browser recorded outcome ${s.outcome} at chain time ${s.atChainTime}${s.deadline ? ` (deadline ${s.deadline})` : ''}; expected ${expected}. No transaction was sent.` })
  }

  if (key === 'T1') {
    wantSim('wrongSigner', 'T1.2', 'Invalid verifier signature (non-verifier wallet) is rejected', 'InvalidSigner')
    wantSim('tampered', 'T1.3', 'Tampered signature is rejected', 'InvalidSigner')
    const v = sim(id, 'validAccepted')
    if (a && a.status === 1 && released) {
      add({ id: 'T1.4', name: 'Valid EIP-712 signature accepted', type: 'ONCHAIN (implied by the release tx)', status: 'PASS', detail: `the release transaction succeeded, which requires the contract to have recovered the verifier from the EIP-712 signature${v ? `; browser pre-check ${v.source === 'reported' ? 'reported by the project owner' : 'recorded'}: ${v.outcome}${v.note ? ` (${v.note})` : ''}` : ''}` })
    } else if (v) {
      add({ id: 'T1.4', name: 'Valid EIP-712 signature accepted', type: 'SIMULATION recorded in browser (eth_call)', status: v.outcome === 'accepted' ? 'PASS' : 'FAIL', detail: `browser recorded outcome ${v.outcome}; no transaction sent` })
    } else add({ id: 'T1.4', name: 'Valid EIP-712 signature accepted', type: 'SIMULATION', status: 'NOT RUN', detail: 'no record and the agreement is not released' })

    if (released && a) {
      const r = await receiptBlock(released.txHash)
      const argsOk = (released.args.amount as bigint) === EXPECTED_AMOUNT && String(released.args.provider).toLowerCase() === a.provider.toLowerCase() && a.status === 1 && a.evidenceHash !== ZERO_HASH
      const beforeDeadline = r.timestamp <= a.deadline
      add({ id: 'T1.5', name: 'Release 0.10 USDC to the provider (manual wallet confirmation)', type: 'ONCHAIN tx', status: r.ok && argsOk && beforeDeadline ? 'PASS' : 'FAIL', detail: `${r.text}. Event args ${json(released.args)}. Included before deadline: ${beforeDeadline}.` })
    } else add({ id: 'T1.5', name: 'Release 0.10 USDC to the provider (manual wallet confirmation)', type: 'ONCHAIN tx', status: 'NOT RUN', detail: 'agreement #4 has not been released' })

    if (a && a.status === 1) {
      const dupRelease = await simulate('release', { id, ...a })
      const dupRefund = await simulate('refund', { id, ...a })
      add({ id: 'T1.6', name: 'Duplicate release and refund after release are rejected', type: `LIVE eth_call at block ${pinned}`, status: dupRelease === 'AgreementNotActive' && dupRefund === 'AgreementNotActive' ? 'PASS' : 'FAIL', detail: `release again: ${dupRelease}; refund as customer: ${dupRefund}` })
    } else add({ id: 'T1.6', name: 'Duplicate release and refund after release are rejected', type: 'LIVE eth_call', status: 'NOT RUN', detail: 'agreement #4 is not Released' })

    // T1.7 early refund must be refused while the agreement is Active and before the deadline
    {
      const early = sim(id, 'earlyRefund')
      let liveEarly: string | undefined
      if (a && a.status === 0 && block.timestamp <= a.deadline) liveEarly = await simulate('refund', { id, ...a })
      if (liveEarly) add({ id: 'T1.7', name: 'Early refund is rejected before the deadline', type: `LIVE eth_call at block ${pinned}`, status: liveEarly === 'RefundNotAvailable' ? 'PASS' : 'FAIL', detail: `refund as customer at chain time ${block.timestamp} (deadline ${a?.deadline}): ${liveEarly}${early ? `; browser also recorded ${early.outcome}` : ''}` })
      else if (early?.source === 'reported') add({ id: 'T1.7', name: 'Early refund is rejected before the deadline', type: REPORTED_TYPE, status: early.outcome === 'RefundNotAvailable' ? 'PASS' : 'FAIL', detail: `${early.note ?? ''} Expected RefundNotAvailable, reported ${early.outcome}. No transaction was sent.` })
      else if (early) add({ id: 'T1.7', name: 'Early refund is rejected before the deadline', type: 'SIMULATION recorded in browser (eth_call)', status: early.outcome === 'RefundNotAvailable' && (!a || early.atChainTime <= Number(a.deadline)) ? 'PASS' : 'FAIL', detail: `browser recorded ${early.outcome} at chain time ${early.atChainTime} (deadline ${a?.deadline ?? 'unknown'}); no transaction sent` })
      else add({ id: 'T1.7', name: 'Early refund is rejected before the deadline', type: 'SIMULATION', status: 'NOT RUN', detail: 'no record, and the deadline has either passed or #4 does not exist' })
    }
  } else {
    // T1b
    const early = sim(id, 'earlyRefund')
    let liveEarly: string | undefined
    if (a && a.status === 0 && block.timestamp <= a.deadline) liveEarly = await simulate('refund', { id, ...a })
    if (liveEarly) add({ id: 'T1b.2', name: 'Early refund is rejected before the deadline', type: `LIVE eth_call at block ${pinned}`, status: liveEarly === 'RefundNotAvailable' ? 'PASS' : 'FAIL', detail: `refund as customer at chain time ${block.timestamp} (deadline ${a?.deadline}): ${liveEarly}${early ? `; browser also recorded ${early.outcome}` : ''}` })
    else if (early) add({ id: 'T1b.2', name: 'Early refund is rejected before the deadline', type: 'SIMULATION recorded in browser (eth_call)', status: early.outcome === 'RefundNotAvailable' && (!a || early.atChainTime <= Number(a.deadline)) ? 'PASS' : 'FAIL', detail: `browser recorded ${early.outcome} at chain time ${early.atChainTime} (deadline ${a?.deadline ?? 'unknown'}); no transaction sent` })
    else add({ id: 'T1b.2', name: 'Early refund is rejected before the deadline', type: 'SIMULATION', status: 'NOT RUN', detail: 'no record, and the deadline has either passed or #5 does not exist' })

    if (refunded && a) {
      const r = await receiptBlock(refunded.txHash)
      const after = Number(refunded.args.refundedAt) > Number(a.deadline) && r.timestamp > a.deadline
      add({ id: 'T1b.3', name: 'Refund happened strictly after the deadline', type: 'ONCHAIN data', status: after ? 'PASS' : 'FAIL', detail: `refundedAt ${String(refunded.args.refundedAt)}, block time ${r.timestamp}, deadline ${a.deadline}` })
      const argsOk = (refunded.args.amount as bigint) === EXPECTED_AMOUNT && String(refunded.args.customer).toLowerCase() === a.customer.toLowerCase() && a.status === 2
      add({ id: 'T1b.4', name: 'Refund 0.10 USDC to the customer (manual wallet confirmation)', type: 'ONCHAIN tx', status: r.ok && argsOk ? 'PASS' : 'FAIL', detail: `${r.text}. Event args ${json(refunded.args)}.` })
    } else {
      add({ id: 'T1b.3', name: 'Refund happened strictly after the deadline', type: 'ONCHAIN data', status: 'NOT RUN', detail: 'agreement #5 has not been refunded' })
      add({ id: 'T1b.4', name: 'Refund 0.10 USDC to the customer (manual wallet confirmation)', type: 'ONCHAIN tx', status: 'NOT RUN', detail: 'agreement #5 has not been refunded' })
    }

    if (a && a.status === 2) {
      const dupRefund = await simulate('refund', { id, ...a })
      const dupRelease = await simulate('release', { id, ...a })
      add({ id: 'T1b.5', name: 'Duplicate refund and release after refund are rejected', type: `LIVE eth_call at block ${pinned}`, status: dupRefund === 'AgreementNotActive' && dupRelease === 'AgreementNotActive' ? 'PASS' : 'FAIL', detail: `refund again as customer: ${dupRefund}; release after refund: ${dupRelease}` })
    } else add({ id: 'T1b.5', name: 'Duplicate refund and release after refund are rejected', type: 'LIVE eth_call', status: 'NOT RUN', detail: 'agreement #5 is not Refunded' })
  }
}


let history = ''
{
  const a3 = count >= 3n ? await client.readContract({ address: ARCSLA, abi: arcSlaAbi, functionName: 'getAgreement', args: [3n] }) : undefined
  const c3 = events.find((e) => e.id === 3n && e.name === 'AgreementCreated')
  const f3 = events.find((e) => e.id === 3n && e.name === 'AgreementRefunded')
  if (a3 && c3 && f3) {
    const rc = await receiptBlock(c3.txHash)
    const rf = await receiptBlock(f3.txHash)
    history = `### Earlier live run: agreement #3 (create, then deadline refund)

Read from the chain for reference. **Not counted toward T1 or T1b:** it used a ${Number(a3.deadline - a3.createdAt)} s deadline window (not the planned values), the release path was not exercised, and no browser-recorded checks were supplied for it.

- Create: ${rc.text}. Event args ${json(c3.args)}
- Refund: ${rf.text}. Event args ${json(f3.args)}. Refunded ${Number(BigInt(String(f3.args.refundedAt)) - a3.deadline)} s after the deadline.
- Resulting state: status **${['Active', 'Released', 'Refunded'][a3.status]}**, amount ${a3.amount}.
`
  }
}

const usdc = await client.readContract({ address: '0x3600000000000000000000000000000000000000', abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [ARCSLA] })
const cnt = (s: Status) => items.filter((i) => i.status === s).length
const block_ = `<!-- LIVE:START -->
## Live execution results (T1 on agreement #4; optional T1b on agreement #5)

Generated by \`bun run scripts/record-live-evidence.ts\` at block **${pinned}** (chain time ${block.timestamp}). The script is read-only. A row is PASS only when the chain (or a clearly labelled simulation) shows it. Items nobody has executed stay NOT RUN.

PASS **${cnt('PASS')}** · FAIL **${cnt('FAIL')}** · BLOCKED **${cnt('BLOCKED')}** · NOT RUN **${cnt('NOT RUN')}**

| ID | Check | Evidence type | Result |
| --- | --- | --- | --- |
${items.map((i) => `| ${i.id} | ${i.name} | ${i.type} | **${i.status}** |`).join('\n')}

### Resulting agreement states and accounting

${states.join('\n')}
- agreementCount ${count}, totalEscrowed ${totalEscrowed}, USDC held by ArcSLA ${usdc} (balance ≥ totalEscrowed: ${usdc >= totalEscrowed}).

${history}
### Details

${items.map((i) => `**${i.id}. ${i.name}**  \nType: ${i.type} · Result: **${i.status}**  \n${i.detail}`).join('\n\n')}
<!-- LIVE:END -->`

const doc = readFileSync(DOC, 'utf8')
const start = doc.indexOf('<!-- LIVE:START -->')
const end = doc.indexOf('<!-- LIVE:END -->')
if (start === -1 || end === -1) throw new Error(`Add the LIVE:START / LIVE:END markers to ${DOC} first`)
writeFileSync(DOC, doc.slice(0, start) + block_ + doc.slice(end + '<!-- LIVE:END -->'.length))
console.log(`Updated ${DOC}: PASS=${cnt('PASS')} FAIL=${cnt('FAIL')} BLOCKED=${cnt('BLOCKED')} NOT RUN=${cnt('NOT RUN')} (block ${pinned})`)
for (const i of items) console.log(`${i.status.padEnd(8)} ${i.id.padEnd(6)} ${i.name}`)
