import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_ID } from '@/lib/env'
import type { ReceiptMap } from '@/lib/demo-journey'

/** Reads transaction receipts (read-only RPC) for the given hashes. Keys are lowercase hashes. */
export function useJourneyReceipts(hashes: readonly Hex[]): ReceiptMap {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const unique = useMemo(() => [...new Set(hashes.map((h) => h.toLowerCase() as Hex))], [hashes])
  const results = useQueries({
    queries: unique.map((hash) => ({
      queryKey: ['arcsla-demo-receipt', CHAIN_ID, hash],
      enabled: !!client,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1,
      queryFn: async () => {
        const r = await client!.getTransactionReceipt({ hash })
        return { status: r.status, from: r.from, blockNumber: r.blockNumber }
      },
    })),
  })
  const map: ReceiptMap = {}
  unique.forEach((hash, i) => {
    const q = results[i]
    map[hash] = q.data ? q.data : q.isError ? 'missing' : 'pending'
  })
  return map
}
