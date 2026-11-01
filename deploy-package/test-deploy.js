// Offline tests for deploy.js. Run: node deploy-package/test-deploy.js
// Uses only a mock wallet provider. Nothing is signed or sent anywhere.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const d = require('./deploy.js')

const data = readFileSync(join(__dirname, 'mainnet', 'deploy-data.hex'), 'utf8')
let passed = 0
async function t(name, fn) {
  await fn()
  passed++
  console.log('PASS', name)
}

;(async () => {
  await t('reviewed deploy-data.hex validates (7,029 bytes, reviewed SHA-256, USDC argument)', async () => {
    const v = await d.validateData(data)
    assert.equal(v.ok, true, v.problems.join('; '))
    assert.equal(v.bytes, 7029)
    assert.equal(v.sha256, d.CONFIG.expectedSha256)
  })

  await t('a single changed nibble is rejected', async () => {
    const i = 400
    const flipped = data.slice(0, i) + (data[i] === '0' ? '1' : '0') + data.slice(i + 1)
    const v = await d.validateData(flipped)
    assert.equal(v.ok, false)
    assert.ok(v.problems.some((p) => p.includes('SHA-256')))
  })

  await t('a different constructor argument is rejected', async () => {
    const other = data.slice(0, -40) + '1c7d4b196cb0c7b01d743fbc6116a902379c7238'
    const v = await d.validateData(other)
    assert.equal(v.ok, false)
    assert.ok(v.problems.some((p) => p.includes('constructor argument')))
  })

  await t('wrong length, missing prefix, odd digits and non-hex are rejected', async () => {
    assert.equal((await d.validateData(data.slice(0, -2))).ok, false)
    assert.equal((await d.validateData(data.slice(2))).ok, false)
    assert.equal((await d.validateData(data + '0')).ok, false)
    assert.equal((await d.validateData('0xzz')).ok, false)
    assert.equal((await d.validateData('')).ok, false)
  })

  const good = async () => ({
    validation: await d.validateData(data),
    chainId: '0x13b2',
    account: d.CONFIG.expectedFrom,
    estimate: 1375814n,
    phrase: 'DEPLOY-5042',
  })

  await t('all five gates open only when everything is satisfied', async () => {
    const s = await good()
    assert.equal(d.evaluateGates(s).allOk, true)
    for (const [key, bad] of [
      ['validation', undefined],
      ['chainId', '0x1'],
      ['chainId', '0x4cef52'], // Arc Testnet must not satisfy the mainnet gate
      ['account', '0x000000000000000000000000000000000000dEaD'],
      ['estimate', undefined],
      ['phrase', 'deploy-5042'],
      ['phrase', ''],
    ]) {
      assert.equal(d.evaluateGates({ ...s, [key]: bad }).allOk, false, `gate must close when ${key}=${String(bad)}`)
    }
  })

  await t('the account gate is case-insensitive for the expected wallet', async () => {
    const s = await good()
    assert.equal(d.evaluateGates({ ...s, account: d.CONFIG.expectedFrom.toLowerCase() }).allOk, true)
  })

  await t('the request is contract creation: from + data only, no to, value, gas or fees', async () => {
    const r = d.buildDeploymentRequest(d.CONFIG.expectedFrom, '0x00')
    assert.deepEqual(Object.keys(r).sort(), ['data', 'from'])
  })

  await t('sendDeployment refuses and never calls the wallet when a gate is closed', async () => {
    const calls = []
    const provider = { request: async (a) => (calls.push(a), '0xhash') }
    const s = { ...(await good()), phrase: 'nope' }
    await assert.rejects(() => d.sendDeployment(provider, s), /safety gates/)
    assert.equal(calls.length, 0)
  })

  await t('sendDeployment calls eth_sendTransaction exactly once with the validated data', async () => {
    const calls = []
    const provider = { request: async (a) => (calls.push(a), '0xabc') }
    const s = await good()
    const hash = await d.sendDeployment(provider, s)
    assert.equal(hash, '0xabc')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'eth_sendTransaction')
    assert.equal(calls[0].params.length, 1)
    assert.equal(calls[0].params[0].to, undefined)
    assert.equal(calls[0].params[0].data, s.validation.hex)
    assert.equal(calls[0].params[0].data.length, 2 + 7029 * 2)
  })

  await t('estimateDeployment is read-only (eth_estimateGas) and refuses on the wrong chain', async () => {
    const calls = []
    const provider = { request: async (a) => (calls.push(a), '0x14fe46') }
    const s = await good()
    const gas = await d.estimateDeployment(provider, s)
    assert.equal(gas, 1375814n)
    assert.deepEqual(calls.map((c) => c.method), ['eth_estimateGas'])
    await assert.rejects(() => d.estimateDeployment(provider, { ...s, chainId: '0x4cef52' }), /expected chain/)
  })

  await t('switchToArcMainnet adds the official parameters only when the wallet does not know the chain', async () => {
    const calls = []
    const unknown = Object.assign(new Error('Unrecognized chain'), { code: 4902 })
    const provider = {
      request: async (a) => {
        calls.push(a)
        if (a.method === 'wallet_switchEthereumChain') throw unknown
        return null
      },
    }
    await d.switchToArcMainnet(provider)
    assert.deepEqual(calls.map((c) => c.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain'])
    const p = calls[1].params[0]
    assert.equal(p.chainId, '0x13b2')
    assert.deepEqual(p.rpcUrls, ['https://rpc.mainnet.arc.io'])
    assert.deepEqual(p.blockExplorerUrls, ['https://explorer.arc.io'])
    assert.equal(p.nativeCurrency.symbol, 'USDC')
    assert.equal(p.nativeCurrency.decimals, 18)
    const rejected = { request: async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }) } }
    await assert.rejects(() => d.switchToArcMainnet(rejected), /User rejected/)
  })

  console.log(`\n${passed} tests passed`)
})().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
