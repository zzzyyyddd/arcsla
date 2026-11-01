/**
 * Offline test of the network configuration: no RPC, no wallet, nothing signed or sent.
 *   bun run scripts/check-network-config.ts
 * It spawns itself ("probe" mode) once per environment scenario and checks what src/lib/env.ts resolves.
 */
import { spawnSync } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { resolveNetwork, NETWORKS } from '../src/lib/networks'

const TESTNET = NETWORKS.testnet.arcsla
const MAINNET = NETWORKS.mainnet.arcsla

if (process.argv[2] === 'probe') {
  const env = await import('../src/lib/env')
  const att = await import('../src/lib/attestation')
  console.log(
    JSON.stringify({
      network: env.NETWORK_KEY, chainId: env.CHAIN_ID, mainnet: env.IS_MAINNET, rpc: env.CHAIN.rpcUrls[0], explorer: env.CHAIN.explorerBase,
      nativeDecimals: env.CHAIN.nativeCurrency.decimals, usdc: env.USDC_ADDRESS, arcsla: env.ARCSLA_ADDRESS, deployBlock: env.DEPLOY_BLOCK?.toString(),
      maxAmount: env.MAX_AGREEMENT_RAW?.toString() ?? null, maxDeadline: env.MAX_DEADLINE_SECONDS ?? null, issues: env.CONFIG_ISSUES, domain: att.attestationDomain(),
    }),
  )
  process.exit(0)
}

type Probe = {
  network: string; chainId: number; mainnet: boolean; rpc: string; explorer: string; nativeDecimals: number; usdc: string; arcsla: string; deployBlock: string
  maxAmount: string | null; maxDeadline: number | null; issues: string[]; domain: { name: string; version: string; chainId: number; verifyingContract: string }
}
function probe(vars: Record<string, string>): Probe {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')))
  const r = spawnSync(process.execPath, ['--no-env-file', 'run', process.argv[1], 'probe'], { env: { ...clean, ...vars }, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`probe failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim().split('\n').pop() as string) as Probe
}

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log('PASS', name)
}

test('default (no env) is Arc Testnet with its own contract', () => {
  const p = probe({})
  assert.equal(p.network, 'testnet'); assert.equal(p.chainId, 5042002); assert.equal(p.arcsla, TESTNET); assert.equal(p.deployBlock, '69654812')
  assert.equal(p.mainnet, false); assert.deepEqual(p.issues, []); assert.equal(p.maxAmount, null)
  assert.equal(p.domain.chainId, 5042002); assert.equal(p.domain.verifyingContract, TESTNET)
})
test('VITE_DEFAULT_NETWORK=mainnet selects Arc Mainnet and ONLY the mainnet contract', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'mainnet' })
  assert.equal(p.network, 'mainnet'); assert.equal(p.chainId, 5042); assert.equal(p.mainnet, true)
  assert.equal(p.arcsla, MAINNET); assert.equal(p.deployBlock, '28741163'); assert.deepEqual(p.issues, [])
  assert.equal(p.rpc, 'https://rpc.mainnet.arc.io'); assert.equal(p.explorer, 'https://explorer.arc.io')
  assert.equal(p.usdc, '0x3600000000000000000000000000000000000000'); assert.equal(p.nativeDecimals, 18)
  assert.equal(p.domain.chainId, 5042); assert.equal(p.domain.verifyingContract, MAINNET); assert.equal(p.domain.name, 'ArcSLA'); assert.equal(p.domain.version, '1')
})
test('older VITE_ARC_CHAIN_ID=5042 still selects mainnet', () => {
  const p = probe({ VITE_ARC_CHAIN_ID: '5042' })
  assert.equal(p.network, 'mainnet'); assert.equal(p.arcsla, MAINNET)
})
test('the old testnet .env values do not leak into a mainnet build', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'mainnet', VITE_ARC_CHAIN_ID: '5042002', VITE_ARCSLA_ADDRESS: TESTNET, VITE_ARCSLA_DEPLOY_BLOCK: '69654812' })
  assert.equal(p.network, 'mainnet'); assert.equal(p.arcsla, MAINNET); assert.equal(p.deployBlock, '28741163'); assert.deepEqual(p.issues, [])
})
test('the testnet contract set as the address on mainnet is rejected', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'mainnet', VITE_ARCSLA_ADDRESS: TESTNET })
  assert.equal(p.arcsla, MAINNET); assert.ok(p.issues.some((i) => i.includes('differs from the registered Arc Mainnet deployment')))
})
test('the mainnet contract set as the address on testnet is rejected', () => {
  const p = probe({ VITE_ARC_CHAIN_ID: '5042002', VITE_ARCSLA_ADDRESS: MAINNET })
  assert.equal(p.network, 'testnet'); assert.equal(p.arcsla, TESTNET); assert.ok(p.issues.some((i) => i.includes('differs from the registered Arc Testnet deployment')))
})
test('an arbitrary address override is rejected on mainnet', () => {
  const p = probe({ VITE_ARC_CHAIN_ID: '5042', VITE_ARCSLA_ADDRESS: '0x1111111111111111111111111111111111111111' })
  assert.ok(p.issues.length === 1 && p.issues[0].includes('differs from the registered'))
})
test('an invalid VITE_DEFAULT_NETWORK falls back to testnet and reports a problem', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'ropsten' })
  assert.equal(p.network, 'testnet'); assert.ok(p.issues.some((i) => i.includes('VITE_DEFAULT_NETWORK')))
})
test('a USDC override on mainnet is rejected', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'mainnet', VITE_USDC_ADDRESS: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' })
  assert.ok(p.issues.some((i) => i.includes('VITE_USDC_ADDRESS')))
})
test('proof-of-concept caps apply on mainnet only', () => {
  const m = probe({ VITE_DEFAULT_NETWORK: 'mainnet', VITE_MAX_AGREEMENT_USDC: '0.01', VITE_MAX_DEADLINE_HOURS: '2' })
  assert.equal(m.maxAmount, '10000'); assert.equal(m.maxDeadline, 7200)
  const t = probe({ VITE_MAX_AGREEMENT_USDC: '0.01', VITE_MAX_DEADLINE_HOURS: '2' })
  assert.equal(t.maxAmount, null); assert.equal(t.maxDeadline, null)
})
test('invalid caps are reported', () => {
  const p = probe({ VITE_DEFAULT_NETWORK: 'mainnet', VITE_MAX_AGREEMENT_USDC: 'abc', VITE_MAX_DEADLINE_HOURS: '-1' })
  assert.equal(p.issues.length, 2)
})
test('resolveNetwork order: URL > saved choice > build default > legacy chain id > testnet', () => {
  assert.deepEqual(resolveNetwork({ urlParam: 'mainnet', saved: 'testnet', buildDefault: 'testnet' }).key, 'mainnet')
  assert.equal(resolveNetwork({ saved: 'testnet', buildDefault: 'mainnet' }).key, 'testnet')
  assert.equal(resolveNetwork({ buildDefault: 'mainnet', legacyChainId: '5042002' }).key, 'mainnet')
  assert.equal(resolveNetwork({ legacyChainId: '5042' }).key, 'mainnet')
  assert.equal(resolveNetwork({}).key, 'testnet')
  assert.equal(resolveNetwork({ urlParam: 'bogus', saved: 'bogus' }).key, 'testnet')
})
test('the two registered deployments are different and belong to different chains', () => {
  assert.notEqual(TESTNET.toLowerCase(), MAINNET.toLowerCase())
  assert.notEqual(NETWORKS.testnet.chainId, NETWORKS.mainnet.chainId)
})

console.log(`\n${passed} network-configuration tests passed. Nothing was sent or signed.`)
