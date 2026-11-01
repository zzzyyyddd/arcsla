import { useChainData } from '@/state/ChainData'

/** States plainly how much event history has been read. */
export function ScanStatus() {
  const { scan } = useChainData()
  let text = 'Waiting to read events'
  if (scan.status === 'scanning') {
    const remaining = scan.head !== undefined && scan.scannedTo !== undefined ? scan.head - scan.scannedTo : undefined
    text = `Reading history${remaining !== undefined ? ` · ${remaining.toString()} blocks remaining` : ''}`
  } else if (scan.status === 'ready') {
    text = scan.lookbackOnly
      ? `Showing the last ${scan.head !== undefined && scan.fromBlock !== undefined ? (scan.head - scan.fromBlock).toString() : 'few'} blocks · set VITE_ARCSLA_DEPLOY_BLOCK for full history`
      : `Full history from block ${scan.fromBlock?.toString() ?? '?'} · head ${scan.head?.toString() ?? '?'}`
  } else if (scan.status === 'error') {
    text = 'Event history could not be read. Retrying.'
  }
  return (
    <span className="text-xs" style={{ color: scan.status === 'error' ? 'var(--danger)' : 'var(--subtle)' }}>
      {text}
    </span>
  )
}
