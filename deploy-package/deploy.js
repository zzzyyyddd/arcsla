/*
 * ArcSLA browser-wallet deployer (no dependencies, no network access of its own).
 *
 * What it does: loads the deployment transaction data from a file YOU generated from YOUR OWN
 * build, refuses to continue unless that data matches the reviewed checksum, and asks your
 * MetaMask/Rabby wallet to send ONE contract-creation transaction on Arc Mainnet. The wallet
 * shows the transaction and you approve or reject it there.
 *
 * It never sees a private key, seed phrase or keystore. It sends nothing by itself: the only
 * state-changing call is the single eth_sendTransaction below, behind five gates and a typed
 * confirmation. The page's Content-Security-Policy blocks every network request from the page.
 */
'use strict'

const CONFIG = Object.freeze({
  chainId: 5042,
  chainIdHex: '0x13b2',
  chainName: 'Arc Mainnet',
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorer: 'https://explorer.arc.io',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  usdc: '0x3600000000000000000000000000000000000000',
  // The wallet that must be connected (public address from the project's testnet evidence).
  // Check it against YOUR wallet: it must be the deployer/customer wallet you intend to use.
  expectedFrom: '0xCfEfEc595970C6850777ac44A99Dd949fAc472A6',
  // creation bytecode (6,997 bytes) + abi.encode(USDC) (32 bytes) = 7,029 bytes
  expectedBytes: 7029,
  // SHA-256 of the 7,029 data bytes (same value as deploy-data.hex in CHECKSUMS.txt)
  expectedSha256: 'ac6db2c9ef94428a99e70aa403bc118aa73acd51ee3d8ee530588ecd8fee3d95',
  confirmPhrase: 'DEPLOY-5042',
})

/** Accepts "0x…" hex (whitespace around it is ignored). Throws on anything else. */
function normalizeHex(text) {
  const t = String(text).trim()
  if (!/^0x[0-9a-fA-F]*$/.test(t)) throw new Error('Data must be 0x-prefixed hexadecimal.')
  if (t.length % 2 !== 0) throw new Error('Hex data has an odd number of digits.')
  return t.toLowerCase()
}

function hexToBytes(hex) {
  const body = hex.slice(2)
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Checks the loaded transaction data against the reviewed package. Never throws. */
async function validateData(text, cfg = CONFIG) {
  const problems = []
  let hex
  try {
    hex = normalizeHex(text)
  } catch (e) {
    return { ok: false, problems: [e.message] }
  }
  const bytes = hexToBytes(hex)
  const sha256 = await sha256Hex(bytes)
  if (bytes.length !== cfg.expectedBytes) problems.push(`Length is ${bytes.length} bytes, expected ${cfg.expectedBytes}.`)
  const wantArg = cfg.usdc.slice(2).toLowerCase().padStart(64, '0')
  if (hex.slice(-64) !== wantArg) problems.push('The last 32 bytes are not the official USDC address as the constructor argument.')
  if (sha256 !== cfg.expectedSha256) problems.push(`SHA-256 is ${sha256}, expected ${cfg.expectedSha256}.`)
  return { ok: problems.length === 0, problems, hex, bytes: bytes.length, sha256 }
}

function sameAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

/** Every gate must be true before the send button is enabled. */
function evaluateGates(state, cfg = CONFIG) {
  const gates = [
    { id: 'data', label: 'Deployment data matches the reviewed checksum', ok: !!state.validation && state.validation.ok },
    { id: 'chain', label: `Wallet is on ${cfg.chainName} (chain ID ${cfg.chainId})`, ok: state.chainId === cfg.chainIdHex },
    { id: 'account', label: 'Connected account is the expected deployer wallet', ok: sameAddress(state.account, cfg.expectedFrom) },
    { id: 'simulated', label: 'Read-only gas estimate succeeded for this exact data', ok: !!state.estimate },
    { id: 'phrase', label: `Typed confirmation "${cfg.confirmPhrase}"`, ok: state.phrase === cfg.confirmPhrase },
  ]
  return { gates, allOk: gates.every((g) => g.ok) }
}

/** The ONE transaction this tool can request: contract creation (no `to`, no value), data only. */
function buildDeploymentRequest(from, data) {
  return { from, data }
}

async function estimateDeployment(provider, state, cfg = CONFIG) {
  if (!state.validation || !state.validation.ok) throw new Error('Data is not validated.')
  if (state.chainId !== cfg.chainIdHex) throw new Error('Wallet is not on the expected chain.')
  const gas = await provider.request({ method: 'eth_estimateGas', params: [buildDeploymentRequest(state.account, state.validation.hex)] })
  return BigInt(gas)
}

async function sendDeployment(provider, state, cfg = CONFIG) {
  const { allOk } = evaluateGates(state, cfg)
  if (!allOk) throw new Error('Not all safety gates are satisfied.')
  return provider.request({ method: 'eth_sendTransaction', params: [buildDeploymentRequest(state.account, state.validation.hex)] })
}

async function switchToArcMainnet(provider, cfg = CONFIG) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chainIdHex }] })
  } catch (e) {
    if (e && (e.code === 4902 || e.code === -32603)) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: cfg.chainIdHex, chainName: cfg.chainName, nativeCurrency: cfg.nativeCurrency, rpcUrls: [cfg.rpcUrl], blockExplorerUrls: [cfg.explorer] }],
      })
    } else {
      throw e
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, normalizeHex, hexToBytes, sha256Hex, validateData, evaluateGates, buildDeploymentRequest, estimateDeployment, sendDeployment, switchToArcMainnet, sameAddress }
}

/* ---------------------------------------------------------------- browser UI (textContent only) */
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id)
  const state = { validation: undefined, chainId: undefined, account: undefined, estimate: undefined, phrase: '' }
  const provider = () => window.ethereum

  function render() {
    $('cfg').textContent = `Network ${CONFIG.chainName} (${CONFIG.chainId}) · USDC ${CONFIG.usdc} · expected wallet ${CONFIG.expectedFrom} · expected SHA-256 ${CONFIG.expectedSha256}`
    $('wallet').textContent = state.account ? `Account ${state.account} on chain ${state.chainId ? parseInt(state.chainId, 16) : '?'}` : 'No wallet connected.'
    const v = state.validation
    $('data').textContent = v ? (v.hex ? `${v.bytes} bytes · SHA-256 ${v.sha256}` : '') + (v.ok ? ' · MATCHES the reviewed checksum' : ' · DOES NOT MATCH: ' + v.problems.join(' ')) : 'No file loaded.'
    $('estimate').textContent = state.estimate ? `Gas estimate (read-only): ${state.estimate.toString()}` : ''
    const { gates, allOk } = evaluateGates(state)
    const list = $('gates')
    list.textContent = ''
    for (const g of gates) {
      const li = document.createElement('li')
      li.textContent = (g.ok ? 'OK    ' : 'TODO  ') + g.label
      list.appendChild(li)
    }
    $('estimateBtn').disabled = !(v && v.ok && state.account && state.chainId === CONFIG.chainIdHex)
    $('sendBtn').disabled = !allOk
  }
  function fail(e) { $('status').textContent = 'Error: ' + (e && e.message ? e.message : String(e)) }

  $('file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]
    if (!f) return
    state.estimate = undefined
    state.validation = await validateData(await f.text())
    render()
  })
  $('connectBtn').addEventListener('click', async () => {
    try {
      if (!provider()) throw new Error('No browser wallet found. Install and unlock MetaMask or Rabby.')
      const accounts = await provider().request({ method: 'eth_requestAccounts' })
      state.account = accounts[0]
      state.chainId = await provider().request({ method: 'eth_chainId' })
      $('status').textContent = ''
      render()
    } catch (e) { fail(e) }
  })
  $('switchBtn').addEventListener('click', async () => {
    try {
      await switchToArcMainnet(provider())
      state.chainId = await provider().request({ method: 'eth_chainId' })
      render()
    } catch (e) { fail(e) }
  })
  $('estimateBtn').addEventListener('click', async () => {
    try { state.estimate = await estimateDeployment(provider(), state); $('status').textContent = ''; render() } catch (e) { fail(e) }
  })
  $('phrase').addEventListener('input', (ev) => { state.phrase = ev.target.value; render() })
  $('sendBtn').addEventListener('click', async () => {
    try {
      $('status').textContent = 'Waiting for you to review and confirm in your wallet…'
      const hash = await sendDeployment(provider(), state)
      $('status').textContent = `Submitted. Transaction hash: ${hash}\nExplorer: ${CONFIG.explorer}/tx/${hash}\nNext: run scripts/verify-deploy.sh --tx ${hash} BEFORE using or funding the contract.`
    } catch (e) { fail(e) }
  })
  if (provider() && provider().on) {
    provider().on('chainChanged', (c) => { state.chainId = c; state.estimate = undefined; render() })
    provider().on('accountsChanged', (a) => { state.account = a[0]; state.estimate = undefined; render() })
  }
  render()
}
