import type { ContractStatus } from './contract-check'

export interface WriteGuardInput {
  /** Static configuration problems (invalid chain ID, missing address, USDC override, ...). */
  configIssues: readonly string[]
  isWalletConnected: boolean
  walletChainId: number | undefined
  expectedChainId: number
  expectedChainName: string
  contractStatus: ContractStatus
  contractDetail?: string
  isMainnet: boolean
  mainnetAcknowledged: boolean
}

/**
 * Returns why transactions and signing must be refused, or undefined when they are allowed.
 * The first matching rule wins.
 */
export function computeBlockedReason(input: WriteGuardInput): string | undefined {
  if (input.configIssues.length > 0) return input.configIssues[0]
  if (input.isWalletConnected && input.walletChainId !== input.expectedChainId) {
    return `Switch your wallet to ${input.expectedChainName}.`
  }
  if (input.contractStatus === 'checking') return 'Verifying the ArcSLA contract on this network…'
  if (input.contractStatus !== 'ok') return input.contractDetail ?? 'The ArcSLA contract could not be verified.'
  if (input.isMainnet && !input.mainnetAcknowledged) {
    return 'Acknowledge the Arc Mainnet real-funds warning to enable transactions.'
  }
  return undefined
}
