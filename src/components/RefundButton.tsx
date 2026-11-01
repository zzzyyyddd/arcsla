import { useEffect } from 'react'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { useTx } from '@/hooks/useTx'
import { ARCSLA_ADDRESS, CHAIN_ID } from '@/lib/env'
import { parseOnchainError } from '@/lib/format'
import { useChainData } from '@/state/ChainData'
import { Notice, TxButton, TxLink } from './ui'

/** Customer-only refund claim for one expired, unsettled agreement. */
export function RefundButton({ id, onDone }: { id: bigint; onDone?: () => void }) {
  const tx = useTx()
  const { refresh } = useChainData()

  useEffect(() => {
    if (tx.isSuccess) {
      refresh()
      onDone?.()
    }
  }, [tx.isSuccess, refresh, onDone])

  if (!ARCSLA_ADDRESS) return null
  const arcsla = ARCSLA_ADDRESS

  return (
    <div className="space-y-2">
      <TxButton
        label="Claim refund"
        variant="primary"
        onClick={() => {
          tx.reset()
          tx.send({ address: arcsla, abi: arcSlaAbi, functionName: 'refund', args: [id], chainId: CHAIN_ID })
        }}
        pending={tx.isPending}
        confirming={tx.isConfirming}
        disabled={tx.isSuccess}
      />
      {tx.isSuccess && tx.hash && (
        <Notice tone="success">
          Refund confirmed. <TxLink hash={tx.hash} />
        </Notice>
      )}
      {tx.isReverted && <Notice tone="error">The refund transaction reverted. No funds moved.</Notice>}
      {tx.error && <Notice tone="error">{parseOnchainError(tx.error)}</Notice>}
    </div>
  )
}
