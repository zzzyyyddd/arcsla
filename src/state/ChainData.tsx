import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { usePublicClient } from 'wagmi'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { ARCSLA_ADDRESS, CHAIN_ID, DEPLOY_BLOCK } from '@/lib/env'
import type { Agreement, ArcEvent } from '@/lib/types'

/** Upper bound on agreements loaded into the list views (newest first). */
const MAX_LISTED = 200n
/** When no deploy block is configured, only this many recent blocks are scanned. */
const LOOKBACK_BLOCKS = 5000n

export interface ScanState {
  status: 'idle' | 'scanning' | 'ready' | 'error'
  fromBlock?: bigint
  scannedTo?: bigint
  head?: bigint
  /** True when no deploy block is configured and history is limited to the lookback window. */
  lookbackOnly: boolean
  error?: string
}

interface ChainData {
  configured: boolean
  agreements: Agreement[]
  agreementCount?: bigint
  totalEscrowed?: bigint
  loadingAgreements: boolean
  agreementsError?: string
  events: ArcEvent[]
  scan: ScanState
  /** Current chain time in seconds (latest block timestamp, advanced by the local clock). */
  now: number
  /** Chain time in seconds read at the moment of the call (use this right before preparing a transaction). */
  getNow: () => number
  refresh: () => void
}

const Ctx = createContext<ChainData | null>(null)

export function useChainData(): ChainData {
  const value = useContext(Ctx)
  if (!value) throw new Error('useChainData must be used inside ChainDataProvider')
  return value
}

export function ChainDataProvider({ children }: { children: ReactNode }) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const configured = !!ARCSLA_ADDRESS
  const [bump, setBump] = useState(0)

  // ---- Chain clock -------------------------------------------------------
  const offsetRef = useRef(0)
  const getNow = useCallback(() => Math.floor(Date.now() / 1000) + offsetRef.current, [])
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const sync = async () => {
      try {
        const block = await client.getBlock()
        if (!cancelled) offsetRef.current = Number(block.timestamp) - Math.floor(Date.now() / 1000)
      } catch {
        /* keep the previous offset */
      }
    }
    void sync()
    const syncTimer = setInterval(() => void sync(), 20_000)
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000) + offsetRef.current), 1000)
    return () => {
      cancelled = true
      clearInterval(syncTimer)
      clearInterval(tick)
    }
  }, [client])

  // ---- Agreements --------------------------------------------------------
  const summary = useQuery({
    queryKey: ['arcsla', 'summary', ARCSLA_ADDRESS],
    enabled: configured && !!client,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client || !ARCSLA_ADDRESS) throw new Error('not configured')
      const [count, totalEscrowed] = await Promise.all([
        client.readContract({ address: ARCSLA_ADDRESS, abi: arcSlaAbi, functionName: 'agreementCount' }),
        client.readContract({ address: ARCSLA_ADDRESS, abi: arcSlaAbi, functionName: 'totalEscrowed' }),
      ])
      const first = count > MAX_LISTED ? count - MAX_LISTED + 1n : 1n
      const ids: bigint[] = []
      for (let id = count; id >= first && id > 0n; id--) ids.push(id)
      const rows = await Promise.all(
        ids.map(async (id) => {
          const a = await client.readContract({
            address: ARCSLA_ADDRESS!,
            abi: arcSlaAbi,
            functionName: 'getAgreement',
            args: [id],
          })
          return { id, ...a }
        }),
      )
      return { count, totalEscrowed, rows }
    },
  })

  // ---- Events (incremental scan) ----------------------------------------
  const [events, setEvents] = useState<ArcEvent[]>([])
  const [scan, setScan] = useState<ScanState>({ status: 'idle', lookbackOnly: DEPLOY_BLOCK === undefined })
  const scannedToRef = useRef<bigint | undefined>(undefined)
  const scanningRef = useRef(false)

  useEffect(() => {
    if (!client || !ARCSLA_ADDRESS) return
    const address = ARCSLA_ADDRESS
    let cancelled = false

    const run = async () => {
      if (scanningRef.current) return
      scanningRef.current = true
      try {
        const head = await client.getBlockNumber()
        const lookbackStart = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n
        const from = scannedToRef.current !== undefined ? scannedToRef.current + 1n : (DEPLOY_BLOCK ?? lookbackStart)
        if (from > head) {
          if (!cancelled) setScan((s) => ({ ...s, status: 'ready', head }))
          return
        }
        if (!cancelled) {
          setScan((s) => ({
            ...s,
            status: scannedToRef.current === undefined ? 'scanning' : s.status,
            fromBlock: s.fromBlock ?? from,
            head,
            lookbackOnly: DEPLOY_BLOCK === undefined,
            error: undefined,
          }))
        }

        const fresh: ArcEvent[] = []
        let cursor = from
        let step = 10_000n
        while (cursor <= head && !cancelled) {
          const end = cursor + step - 1n > head ? head : cursor + step - 1n
          try {
            const logs = await client.getContractEvents({ address, abi: arcSlaAbi, fromBlock: cursor, toBlock: end })
            for (const log of logs) {
              const mapped = mapLog(log)
              if (mapped) fresh.push(mapped)
            }
            cursor = end + 1n
            if (!cancelled) setScan((s) => ({ ...s, scannedTo: end }))
          } catch (error) {
            if (step <= 250n) throw error
            step = step / 2n
          }
        }
        if (cancelled) return
        scannedToRef.current = head
        if (fresh.length > 0) {
          setEvents((prev) => dedupe([...prev, ...fresh]))
        }
        setScan((s) => ({ ...s, status: 'ready', scannedTo: head, head }))
      } catch (error) {
        if (!cancelled) {
          setScan((s) => ({ ...s, status: 'error', error: error instanceof Error ? error.message : 'Event scan failed' }))
        }
      } finally {
        scanningRef.current = false
      }
    }

    void run()
    const timer = setInterval(() => void run(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
      scanningRef.current = false
    }
  }, [client, bump])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['arcsla'] })
    setBump((n) => n + 1)
  }, [queryClient])

  const value = useMemo<ChainData>(
    () => ({
      configured,
      agreements: summary.data?.rows ?? [],
      agreementCount: summary.data?.count,
      totalEscrowed: summary.data?.totalEscrowed,
      loadingAgreements: configured && summary.isLoading,
      agreementsError: summary.error ? 'Could not read agreements from the contract.' : undefined,
      events,
      scan,
      now,
      getNow,
      refresh,
    }),
    [configured, summary.data, summary.isLoading, summary.error, events, scan, now, getNow, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function dedupe(list: ArcEvent[]): ArcEvent[] {
  const seen = new Set<string>()
  const out: ArcEvent[] = []
  for (const e of list) {
    const key = `${e.txHash}:${e.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  )
}

interface RawLog {
  eventName?: string
  args?: unknown
  blockNumber: bigint | null
  logIndex: number | null
  transactionHash: Hex | null
}

function mapLog(log: RawLog): ArcEvent | undefined {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) return undefined
  const base = { blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash }
  const name = log.eventName
  const args = (log.args ?? {}) as Record<string, unknown>
  if (name === 'AgreementCreated') {
    return {
      ...base,
      kind: 'created',
      id: args.id as bigint,
      amount: args.amount as bigint,
      at: args.createdAt as bigint,
      customer: args.customer as ArcEvent['customer'],
      provider: args.provider as ArcEvent['provider'],
      verifier: args.verifier as ArcEvent['verifier'],
      specHash: args.specHash as ArcEvent['specHash'],
      deadline: args.deadline as bigint,
    }
  }
  if (name === 'AgreementReleased') {
    return {
      ...base,
      kind: 'released',
      id: args.id as bigint,
      amount: args.amount as bigint,
      at: args.releasedAt as bigint,
      provider: args.provider as ArcEvent['provider'],
      verifier: args.verifier as ArcEvent['verifier'],
      submitter: args.submitter as ArcEvent['submitter'],
      specHash: args.specHash as ArcEvent['specHash'],
      evidenceHash: args.evidenceHash as ArcEvent['evidenceHash'],
      attestationExpiry: args.attestationExpiry as bigint,
    }
  }
  if (name === 'AgreementRefunded') {
    return {
      ...base,
      kind: 'refunded',
      id: args.id as bigint,
      amount: args.amount as bigint,
      at: args.refundedAt as bigint,
      customer: args.customer as ArcEvent['customer'],
    }
  }
  return undefined
}
