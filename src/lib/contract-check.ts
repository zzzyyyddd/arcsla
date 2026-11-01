import type { Address, Hex } from 'viem'

/**
 * Verifies that an address really is an ArcSLA v1 contract on the expected chain.
 * Pure logic over a small read interface so the browser guard and the testnet
 * evidence script run exactly the same checks.
 */
export type ContractStatus = 'unconfigured' | 'checking' | 'ok' | 'missing' | 'mismatch' | 'unreachable'

export interface ContractCheckResult {
  status: ContractStatus
  detail?: string
}

export type Eip712DomainTuple = readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]]

export interface ContractCheckProbe {
  getChainId: () => Promise<number>
  getCode: (address: Address) => Promise<Hex | undefined>
  readUsdc: (address: Address) => Promise<Address>
  readDomain: (address: Address) => Promise<Eip712DomainTuple>
}

export interface ContractCheckExpectation {
  address: Address
  usdc: Address
  chainId: number
  chainName: string
}

export async function verifyArcSlaContract(
  probe: ContractCheckProbe,
  expected: ContractCheckExpectation,
): Promise<ContractCheckResult> {
  const { address, usdc, chainId, chainName } = expected

  const rpcChainId = await probe.getChainId()
  if (rpcChainId !== chainId) {
    return { status: 'mismatch', detail: `The RPC reports chain ${rpcChainId} but this app is configured for ${chainName} (${chainId}).` }
  }

  const code = await probe.getCode(address)
  if (!code || code === '0x') {
    return { status: 'missing', detail: `No contract exists at ${address} on ${chainName}.` }
  }

  try {
    const [token, domain] = await Promise.all([probe.readUsdc(address), probe.readDomain(address)])
    const [, name, version, domainChainId, verifyingContract] = domain
    if (name !== 'ArcSLA' || version !== '1') {
      return { status: 'mismatch', detail: 'The contract at this address is not ArcSLA v1.' }
    }
    if (domainChainId !== BigInt(chainId) || verifyingContract.toLowerCase() !== address.toLowerCase()) {
      return { status: 'mismatch', detail: 'The contract’s signing domain does not match this chain and address.' }
    }
    if (token.toLowerCase() !== usdc.toLowerCase()) {
      return { status: 'mismatch', detail: `The contract settles in ${token}, not the expected USDC ${usdc}.` }
    }
  } catch {
    return { status: 'mismatch', detail: 'The contract at this address does not behave like ArcSLA.' }
  }
  return { status: 'ok' }
}
