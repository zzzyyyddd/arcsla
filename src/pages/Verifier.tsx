import { useEffect, useMemo, useState } from 'react'
import { hashTypedData, keccak256, recoverTypedDataAddress, toBytes, type Hex } from 'viem'
import { useAccount, usePublicClient, useReadContract, useSignTypedData } from 'wagmi'
import { CheckCircle2, PenLine, ShieldAlert } from 'lucide-react'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { useTx } from '@/hooks/useTx'
import { ARCSLA_ADDRESS, CHAIN_ID } from '@/lib/env'
import { attestationDomain, corruptSignature, FULFILLMENT_TYPES, markRejectionTested } from '@/lib/attestation'
import { recordSim } from '@/lib/liveEvidence'
import { findRevertName, fmtDateTime, fmtUsdc, isBytes32, parseOnchainError, REVERT_COPY, sameAddress } from '@/lib/format'
import { Link, navigate, useLocation } from '@/lib/router'
import type { Agreement } from '@/lib/types'
import { useChainData } from '@/state/ChainData'
import { AddressChip, Card, HashChip, Notice, PageHeader, Row, SetupRequired, StatusBadge, TxButton, TxLink } from '@/components/ui'

const VALIDITY = [
  { label: '15 minutes', seconds: 900 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
]

interface Signed {
  agreementId: bigint
  evidenceHash: Hex
  expiry: bigint
  signature: Hex
  recovered: string
  digestMatches: boolean | undefined
}

type SimResult = { agreementId: bigint } & ({ ok: true } | { ok: false; name: string; copy: string })

export default function Verifier() {
  const { search } = useLocation()
  const data = useChainData()
  const { address } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { signTypedDataAsync } = useSignTypedData()

  const idText = search.get('id') ?? ''
  const id = /^\d+$/.test(idText) ? BigInt(idText) : undefined

  const [evMode, setEvMode] = useState<'text' | 'hash'>('text')
  const [evText, setEvText] = useState('')
  const [evHash, setEvHash] = useState('')
  const [validity, setValidity] = useState(3600)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string>()
  const [signedState, setSigned] = useState<Signed>()
  const [signatureOverride, setSignatureOverride] = useState<string>()
  const [simState, setSimResult] = useState<SimResult>()
  const [simulating, setSimulating] = useState(false)
  const releaseTx = useTx()

  const query = useReadContract({
    address: ARCSLA_ADDRESS,
    abi: arcSlaAbi,
    functionName: 'getAgreement',
    args: id !== undefined ? [id] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!ARCSLA_ADDRESS && id !== undefined, refetchInterval: 10_000, retry: false },
  })
  const agreement: Agreement | undefined = useMemo(
    () => (query.data && id !== undefined ? ({ id, ...query.data }) : undefined),
    [query.data, id],
  )

  const evidenceHash: Hex | undefined = useMemo(() => {
    if (evMode === 'text') return evText.trim() ? keccak256(toBytes(evText.trim())) : undefined
    const candidate = evHash.trim()
    return isBytes32(candidate) && BigInt(candidate) !== 0n ? (candidate) : undefined
  }, [evMode, evText, evHash])

  useEffect(() => {
    if (releaseTx.isSuccess) data.refresh()
  }, [releaseTx.isSuccess, data])

  if (!ARCSLA_ADDRESS) {
    return (
      <>
        <PageHeader title="Verifier console" />
        <SetupRequired />
      </>
    )
  }
  const arcsla = ARCSLA_ADDRESS
  const signed = signedState && id !== undefined && signedState.agreementId === id ? signedState : undefined
  const simResult = simState && id !== undefined && simState.agreementId === id ? simState : undefined
  const signatureInput = signatureOverride ?? signed?.signature ?? ''

  const isVerifier = !!agreement && sameAddress(address, agreement.verifier)
  const expired = !!agreement && data.now > Number(agreement.deadline)
  const canSign = !!agreement && agreement.status === 0 && !expired && !!evidenceHash

  const sign = async () => {
    if (!agreement || !evidenceHash) return
    setSigning(true)
    setSignError(undefined)
    setSimResult(undefined)
    try {
      const expiry = BigInt(data.now + validity)
      const message = {
        agreementId: agreement.id,
        specHash: agreement.specHash,
        provider: agreement.provider,
        evidenceHash,
        expiry,
      }
      const domain = attestationDomain()
      const signature = await signTypedDataAsync({ domain, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message })
      const recovered = await recoverTypedDataAddress({ domain, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message, signature })

      let digestMatches: boolean | undefined
      try {
        const onchain = await client?.readContract({
          address: arcsla,
          abi: arcSlaAbi,
          functionName: 'fulfillmentDigest',
          args: [message.agreementId, message.specHash, message.provider, message.evidenceHash, message.expiry],
        })
        digestMatches = onchain !== undefined ? onchain === hashTypedData({ domain, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message }) : undefined
      } catch {
        digestMatches = undefined
      }
      setSigned({ agreementId: agreement.id, evidenceHash, expiry, signature, recovered, digestMatches })
      setSignatureOverride(undefined)
    } catch (error) {
      setSignError(parseOnchainError(error))
    } finally {
      setSigning(false)
    }
  }

  const submittedEvidence = signed?.evidenceHash
  const submittedExpiry = signed?.expiry
  const signatureValid = /^0x[0-9a-fA-F]{130}$/.test(signatureInput.trim())
  const releaseArgs =
    agreement && submittedEvidence && submittedExpiry !== undefined && signatureValid
      ? ([agreement.id, agreement.specHash, agreement.provider, submittedEvidence, submittedExpiry, signatureInput.trim() as Hex] as const)
      : undefined

  const simulate = async (sig: Hex, recordRejection: boolean) => {
    if (!client || !agreement || !submittedEvidence || submittedExpiry === undefined) return
    setSimulating(true)
    setSimResult(undefined)
    try {
      await client.simulateContract({
        address: arcsla,
        abi: arcSlaAbi,
        functionName: 'release',
        args: [agreement.id, agreement.specHash, agreement.provider, submittedEvidence, submittedExpiry, sig],
        account: address,
      })
      setSimResult({ agreementId: agreement.id, ok: true })
      if (!recordRejection && signed && sameAddress(signed.recovered, agreement.verifier) && sig === signed.signature) {
        recordSim({ agreementId: agreement.id.toString(), kind: 'validAccepted', outcome: 'accepted', atChainTime: data.now, deadline: Number(agreement.deadline) })
      }
    } catch (error) {
      const name = findRevertName(error) ?? 'Reverted'
      setSimResult({ agreementId: agreement.id, ok: false, name, copy: REVERT_COPY[name] ?? 'The contract rejected this call.' })
      if (recordRejection && name === 'InvalidSigner') markRejectionTested(name)
      if (recordRejection) {
        recordSim({ agreementId: agreement.id.toString(), kind: 'tampered', outcome: name, atChainTime: data.now, deadline: Number(agreement.deadline) })
      } else if (name === 'InvalidSigner' && signed && sig === signed.signature && !sameAddress(signed.recovered, agreement.verifier)) {
        recordSim({ agreementId: agreement.id.toString(), kind: 'wrongSigner', outcome: name, atChainTime: data.now, deadline: Number(agreement.deadline) })
      }
    } finally {
      setSimulating(false)
    }
  }

  const submit = () => {
    if (!releaseArgs) return
    releaseTx.reset()
    releaseTx.send({ address: arcsla, abi: arcSlaAbi, functionName: 'release', args: releaseArgs, chainId: CHAIN_ID })
  }

  return (
    <>
      <PageHeader
        title="Verifier console"
        subtitle="Inspect an agreement, sign an EIP-712 fulfillment attestation with the verifier wallet, and submit it to settle. Anyone can submit a valid signature."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <label className="label" htmlFor="agreement-id">Agreement ID</label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="agreement-id"
                inputMode="numeric"
                className="input tabular-nums"
                placeholder="1"
                value={idText}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '')
                  navigate(v ? `/verifier?id=${v}` : '/verifier')
                }}
              />
            </div>

            {id !== undefined && query.isLoading && <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Reading agreement…</p>}
            {id !== undefined && query.error && <div className="mt-3"><Notice tone="error">No agreement with this ID.</Notice></div>}

            {agreement && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="display text-3xl font-bold tabular-nums">{fmtUsdc(agreement.amount)} <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>USDC</span></span>
                  <StatusBadge status={agreement.status} />
                </div>
                <Row label="Customer"><AddressChip address={agreement.customer} /></Row>
                <Row label="Provider"><AddressChip address={agreement.provider} /></Row>
                <Row label="Verifier"><AddressChip address={agreement.verifier} /></Row>
                <Row label="Deadline">{fmtDateTime(agreement.deadline)}</Row>
                <Row label="Specification hash"><HashChip hash={agreement.specHash} /></Row>
                <div className="mt-2"><Link to={`/agreement/${agreement.id}`} className="text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>Open full agreement</Link></div>
              </div>
            )}
          </Card>

          {agreement && (
            <Card>
              <div className="flex items-center gap-2">
                <PenLine className="size-5" />
                <h2 className="display text-xl font-semibold">Sign attestation</h2>
              </div>

              {agreement.status !== 0 ? (
                <div className="mt-3"><Notice tone="info">This agreement is already settled, so no further attestation can be used.</Notice></div>
              ) : expired ? (
                <div className="mt-3"><Notice tone="warn">The deadline has passed. The contract will reject releases; the customer can claim a refund.</Notice></div>
              ) : (
                <div className="mt-3 space-y-4">
                  {address && !isVerifier && (
                    <Notice tone="warn">
                      The connected wallet is not this agreement’s verifier. A signature from it will be rejected by the contract, which is useful for testing rejection but cannot settle.
                    </Notice>
                  )}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="label">Fulfillment evidence</span>
                      <div className="inline-flex rounded-xl p-0.5" style={{ background: 'var(--surface-muted)' }}>
                        {(['text', 'hash'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setEvMode(m)}
                            className="rounded-[10px] px-3 py-1.5 text-xs font-semibold"
                            style={{ background: evMode === m ? '#fff' : 'transparent', color: evMode === m ? 'var(--ink)' : 'var(--muted)' }}
                          >
                            {m === 'text' ? 'Describe & hash' : 'I have a hash'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {evMode === 'text' ? (
                      <textarea rows={3} className="input mt-1.5" placeholder="Reference to the delivered work, e.g. a delivery report or content hash." value={evText} onChange={(e) => setEvText(e.target.value)} />
                    ) : (
                      <input className="input mono mt-1.5" placeholder="0x… (32 bytes)" value={evHash} onChange={(e) => setEvHash(e.target.value)} spellCheck={false} />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
                      <span>Evidence hash:</span>
                      {evidenceHash ? <HashChip hash={evidenceHash} /> : <span>—</span>}
                    </div>
                  </div>

                  <div>
                    <span className="label">Attestation valid for</span>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {VALIDITY.map((v) => (
                        <button
                          key={v.seconds}
                          type="button"
                          onClick={() => setValidity(v.seconds)}
                          className="rounded-full px-3 py-1.5 text-xs font-semibold"
                          style={{
                            background: validity === v.seconds ? 'var(--accent)' : 'var(--surface-strong)',
                            color: validity === v.seconds ? '#fff' : 'var(--ink)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <TxButton className="w-full" label="Sign with connected wallet" onClick={() => void sign()} disabled={!canSign} pending={signing} />
                  {signError && <Notice tone="error">{signError}</Notice>}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="display text-xl font-semibold">Signed attestation</h2>
            {!signed ? (
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                Sign with the verifier wallet to produce an attestation. The typed data binds this agreement, its specification hash, the provider, the evidence hash, an expiry, this contract and this chain.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <Row label="Recovered signer"><AddressChip address={signed.recovered as `0x${string}`} /></Row>
                <Row label="Matches verifier">
                  {agreement && sameAddress(signed.recovered, agreement.verifier) ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--success)' }}><CheckCircle2 className="size-4" /> Yes</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--danger)' }}><ShieldAlert className="size-4" /> No, the contract will reject it</span>
                  )}
                </Row>
                <Row label="Digest vs contract">
                  {signed.digestMatches === undefined ? '—' : signed.digestMatches ? <span style={{ color: 'var(--success)' }} className="font-semibold">Identical</span> : <span style={{ color: 'var(--danger)' }} className="font-semibold">Different</span>}
                </Row>
                <Row label="Expires">{fmtDateTime(signed.expiry)}</Row>
                <div>
                  <label className="label" htmlFor="sig">Signature (editable, anyone may submit)</label>
                  <textarea id="sig" rows={3} className="input mono mt-1.5 text-xs" value={signatureInput} onChange={(e) => { setSignatureOverride(e.target.value.trim()); setSimResult(undefined) }} spellCheck={false} />
                  {!signatureValid && signatureInput && <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>A signature is 65 bytes (132 hex characters with 0x).</p>}
                </div>
              </div>
            )}
          </Card>

          {signed && agreement && (
            <Card>
              <h2 className="display text-xl font-semibold">Settle onchain</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                A check runs the contract’s own verification against the current chain state with no transaction and no gas.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-ghost" disabled={!releaseArgs || simulating} onClick={() => void simulate(signatureInput.trim() as Hex, false)}>
                  {simulating ? 'Checking…' : 'Check this signature'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!signed || simulating}
                  onClick={() => void simulate(corruptSignature(signed.signature), true)}
                  title="Alters one byte of the signature and asks the contract to verify it"
                >
                  Test a tampered signature
                </button>
              </div>

              {simResult && (
                <div className="mt-3">
                  {simResult.ok ? (
                    <Notice tone="success">The contract would accept this attestation right now.</Notice>
                  ) : (
                    <Notice tone={simResult.name === 'InvalidSigner' ? 'info' : 'warn'}>
                      <span className="font-semibold">{simResult.name}</span>: {simResult.copy} (simulated, no transaction sent)
                    </Notice>
                  )}
                </div>
              )}

              <div className="mt-4">
                <TxButton className="w-full" label="Submit & release payment" onClick={submit} disabled={!releaseArgs} pending={releaseTx.isPending} confirming={releaseTx.isConfirming} />
              </div>
              {releaseTx.isSuccess && releaseTx.hash && (
                <div className="mt-3">
                  <Notice tone="success">
                    Payment released to the provider. <TxLink hash={releaseTx.hash} />
                  </Notice>
                </div>
              )}
              {releaseTx.isReverted && <div className="mt-3"><Notice tone="error">The transaction reverted. No funds moved.</Notice></div>}
              {releaseTx.error && <div className="mt-3"><Notice tone="error">{parseOnchainError(releaseTx.error)}</Notice></div>}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
