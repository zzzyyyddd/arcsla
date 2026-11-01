import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { ARCSLA_ADDRESS, CHAIN, CHAIN_ID, CONFIG_ISSUES, IS_MAINNET, USDC_ADDRESS } from '@/lib/env'
import { verifyArcSlaContract, type ContractCheckResult, type ContractStatus } from '@/lib/contract-check'
import { computeBlockedReason } from '@/lib/write-guard'

interface NetworkGuard {
  contractStatus: ContractStatus
  contractDetail?: string
  /** True on Arc Mainnet: the user must acknowledge real-funds risk before any wallet prompt. */
  ackRequired: boolean
  acknowledged: boolean
  setAcknowledged: (value: boolean) => void
  configIssues: string[]
  /** Set whenever writes (and signing) must be refused. Undefined means allowed. */
  blockedReason?: string
}

const Ctx = createContext<NetworkGuard | null>(null)

const ackKey = `arcsla.mainnetAck.${CHAIN_ID}.${ARCSLA_ADDRESS ?? 'none'}`

function readAck(): boolean {
  try {
    return sessionStorage.getItem(ackKey) === '1'
  } catch {
    return false
  }
}

export function useWriteGuard(): NetworkGuard {
  const value = useContext(Ctx)
  if (!value) throw new Error('useWriteGuard must be used inside NetworkGuardProvider')
  return value
}

export function NetworkGuardProvider({ children }: { children: ReactNode }) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { isConnected, chainId: walletChainId } = useAccount()
  const [acknowledged, setAck] = useState(readAck)

  const setAcknowledged = useCallback((value: boolean) => {
    setAck(value)
    try {
      if (value) sessionStorage.setItem(ackKey, '1')
      else sessionStorage.removeItem(ackKey)
    } catch {
      /* storage unavailable: acknowledgement lasts for this page view only */
    }
  }, [])

  const check = useQuery({
    queryKey: ['arcsla-guard', 'contract', CHAIN_ID, ARCSLA_ADDRESS, USDC_ADDRESS],
    enabled: !!client && !!ARCSLA_ADDRESS && !!USDC_ADDRESS,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async (): Promise<ContractCheckResult> => {
      if (!client || !ARCSLA_ADDRESS || !USDC_ADDRESS) return { status: 'unconfigured' }
      return verifyArcSlaContract(
        {
          getChainId: () => client.getChainId(),
          getCode: (address) => client.getCode({ address }),
          readUsdc: (address) => client.readContract({ address, abi: arcSlaAbi, functionName: 'usdc' }),
          readDomain: (address) => client.readContract({ address, abi: arcSlaAbi, functionName: 'eip712Domain' }),
        },
        { address: ARCSLA_ADDRESS, usdc: USDC_ADDRESS, chainId: CHAIN_ID, chainName: CHAIN.name },
      )
    },
  })

  const contractStatus: ContractStatus = !ARCSLA_ADDRESS || !USDC_ADDRESS
    ? 'unconfigured'
    : check.isError
      ? 'unreachable'
      : (check.data?.status ?? 'checking')
  const contractDetail = check.isError ? 'Could not reach the RPC to verify the contract.' : check.data?.detail

  const value = useMemo<NetworkGuard>(() => {
    const blockedReason = computeBlockedReason({
      configIssues: CONFIG_ISSUES,
      isWalletConnected: isConnected,
      walletChainId,
      expectedChainId: CHAIN_ID,
      expectedChainName: CHAIN.name,
      contractStatus,
      contractDetail,
      isMainnet: IS_MAINNET,
      mainnetAcknowledged: acknowledged,
    })

    return {
      contractStatus,
      contractDetail,
      ackRequired: IS_MAINNET,
      acknowledged,
      setAcknowledged,
      configIssues: CONFIG_ISSUES,
      blockedReason,
    }
  }, [contractStatus, contractDetail, acknowledged, setAcknowledged, isConnected, walletChainId])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
