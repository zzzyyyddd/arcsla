import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CHAIN_ID } from '@/lib/env'
import { useWriteGuard } from '@/state/NetworkGuard'

/** One contract write plus its receipt, with honest state from wagmi only. */
export function useTx() {
  const write = useWriteContract()
  const guard = useWriteGuard()
  // Hard stop: even if a button is somehow enabled, no wallet prompt is opened while the
  // chain, contract address or mainnet acknowledgement is unverified.
  const send = ((...args: Parameters<typeof write.writeContract>) => {
    if (guard.blockedReason) return
    write.writeContract(...args)
  }) as typeof write.writeContract
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: CHAIN_ID })
  const reverted = receipt.data?.status === 'reverted'
  return {
    send,
    hash: write.data,
    isPending: write.isPending,
    isConfirming: !!write.data && receipt.isLoading,
    isSuccess: receipt.isSuccess && !reverted,
    isReverted: reverted,
    receipt: receipt.data,
    error: write.error ?? receipt.error ?? undefined,
    reset: write.reset,
  }
}

export type Tx = ReturnType<typeof useTx>

/** Wallet + network readiness for the configured chain. */
export function useWalletGate() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const wrongChain = isConnected && chainId !== CHAIN_ID
  return {
    address,
    isConnected,
    wrongChain,
    switching,
    switchToApp: () => switchChain({ chainId: CHAIN_ID }),
  }
}
