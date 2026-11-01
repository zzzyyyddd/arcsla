import { useEffect, useMemo, useState } from 'react'
import { erc20Abi, isAddress, keccak256, parseEventLogs, toBytes, type Address, type Hex } from 'viem'
import { useReadContract } from 'wagmi'
import { CheckCircle2 } from 'lucide-react'
import { arcSlaAbi } from '@/contracts/ArcSLA.abi'
import { useTx, useWalletGate } from '@/hooks/useTx'
import { ARCSLA_ADDRESS, CHAIN, CHAIN_ID, IS_MAINNET, MAX_AGREEMENT_RAW, MAX_DEADLINE_SECONDS, USDC_ADDRESS } from '@/lib/env'
import { fmtUsdc, isBytes32, parseOnchainError, sameAddress } from '@/lib/format'
import { Link, useLocation } from '@/lib/router'
import { isPresetKey, RUNBOOK_PRESETS, RUNBOOK_WALLETS } from '@/lib/runbook'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { useChainData } from '@/state/ChainData'
import { Card, HashChip, Notice, PageHeader, SetupRequired, TxButton, TxLink } from '@/components/ui'
import { DeadlineField } from '@/components/DeadlineField'
import { deadlineError, parseDeadlineInput, submissionBlock, toLocalInput } from '@/lib/deadline'

export default function Create() {
  const data = useChainData()
  const gate = useWalletGate()
  // Optional runbook preset (?preset=t1 | t1b): pre-fills the form once. Nothing is sent until you
  // press the buttons below and confirm in your wallet.
  const { search } = useLocation()
  const presetParam = search.get('preset')
  // Presets hold the testnet owner's wallets, so they are ignored on mainnet.
  const preset = !IS_MAINNET && isPresetKey(presetParam) ? RUNBOOK_PRESETS[presetParam] : undefined
  const [provider, setProvider] = useState(preset ? RUNBOOK_WALLETS.provider : '')
  const [verifier, setVerifier] = useState(preset ? RUNBOOK_WALLETS.verifier : '')
  const [amountText, setAmountText] = useState(preset?.amount ?? '')
  const [deadlineText, setDeadlineText] = useState(() => (preset ? toLocalInput(data.now + preset.deadlineMinutes * 60 + 30) : ''))
  const [mode, setMode] = useState<'describe' | 'hash'>('describe')
  const [description, setDescription] = useState(preset?.description ?? '')
  const [manualHash, setManualHash] = useState('')

  const approveTx = useTx()
  const createTx = useTx()

  const specHash: Hex | undefined = useMemo(() => {
    if (mode === 'describe') return description.trim() ? keccak256(toBytes(description.trim())) : undefined
    const candidate = manualHash.trim()
    return isBytes32(candidate) && BigInt(candidate) !== 0n ? (candidate) : undefined
  }, [mode, description, manualHash])

  const amount = useMemo(() => {
    try {
      const v = parseUsdc(amountText || '0')
      return v > 0n ? v : undefined
    } catch {
      return undefined
    }
  }, [amountText])

  const deadlineSeconds = parseDeadlineInput(deadlineText)
  const [submitBlocked, setSubmitBlocked] = useState<string>()

  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: gate.address ? [gate.address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!USDC_ADDRESS && !!gate.address, refetchInterval: 10_000 },
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: gate.address && ARCSLA_ADDRESS ? [gate.address, ARCSLA_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!USDC_ADDRESS && !!gate.address && !!ARCSLA_ADDRESS },
  })

  useEffect(() => {
    if (approveTx.isSuccess) void allowance.refetch()
  }, [approveTx.isSuccess, allowance])

  useEffect(() => {
    if (createTx.isSuccess) {
      data.refresh()
      void balance.refetch()
      void allowance.refetch()
    }
  }, [createTx.isSuccess, data, balance, allowance])

  const createdId = useMemo(() => {
    if (!createTx.receipt) return undefined
    const logs = parseEventLogs({ abi: arcSlaAbi, logs: createTx.receipt.logs, eventName: 'AgreementCreated' })
    return logs[0]?.args.id
  }, [createTx.receipt])

  if (!ARCSLA_ADDRESS) {
    return (
      <>
        <PageHeader title="Create agreement" />

      {IS_MAINNET && (MAX_AGREEMENT_RAW !== undefined || MAX_DEADLINE_SECONDS !== undefined) && (
        <div className="mb-3">
          <Notice tone="warn">
            Controlled proof-of-concept limits are active on {CHAIN.name}
            {MAX_AGREEMENT_RAW !== undefined && `: at most ${formatUsdc(MAX_AGREEMENT_RAW)} USDC per agreement`}
            {MAX_DEADLINE_SECONDS !== undefined && `, deadline within ${(MAX_DEADLINE_SECONDS / 3600).toString()} hours`}. These limits are enforced by this app only; the contract itself has none.
          </Notice>
        </div>
      )}

      {preset && (
        <div className="mb-3">
          <Notice tone="info">
            Runbook {preset.key.toUpperCase()}: the form is pre-filled for agreement #{preset.expectedId.toString()} ({preset.amount} test USDC, deadline about {preset.deadlineMinutes} minutes from now). Check every field. Nothing is sent until you press a button and confirm in your own wallet.
            {gate.isConnected && !sameAddress(gate.address, RUNBOOK_WALLETS.customer) && ' Your connected wallet is not the planned customer wallet; switch if you want to follow the plan exactly.'}
          </Notice>
        </div>
      )}
        <SetupRequired />
      </>
    )
  }
  if (!USDC_ADDRESS) {
    return (
      <>
        <PageHeader title="Create agreement" />
        <Notice tone="error">No USDC address is configured for {CHAIN.name}. Set VITE_USDC_ADDRESS to a verified token address.</Notice>
      </>
    )
  }

  const arcsla = ARCSLA_ADDRESS
  const usdcToken = USDC_ADDRESS
  const issues: string[] = []
  if (!isAddress(provider)) issues.push('Enter a valid provider address.')
  if (!isAddress(verifier)) issues.push('Enter a valid verifier address.')
  if (isAddress(provider) && isAddress(verifier)) {
    if (sameAddress(provider, verifier)) issues.push('Provider and verifier must be different accounts.')
    if (sameAddress(provider, gate.address) || sameAddress(verifier, gate.address)) {
      issues.push('Provider and verifier must be different from your connected wallet.')
    }
    for (const reserved of [arcsla, usdcToken]) {
      if (sameAddress(provider, reserved) || sameAddress(verifier, reserved)) {
        issues.push('Provider and verifier cannot be the ArcSLA or USDC contract.')
        break
      }
    }
  }
  if (!amount) issues.push('Enter an amount greater than zero (up to 6 decimals).')
  const deadlineProblem = deadlineError(deadlineSeconds, data.now, MAX_DEADLINE_SECONDS)
  if (deadlineProblem) issues.push(deadlineProblem)
  if (amount && MAX_AGREEMENT_RAW !== undefined && amount > MAX_AGREEMENT_RAW) {
    issues.push(`This configuration caps agreements at ${formatUsdc(MAX_AGREEMENT_RAW)} USDC (VITE_MAX_AGREEMENT_USDC).`)
  }
  if (!specHash) issues.push(mode === 'describe' ? 'Describe the service to hash.' : 'Enter a non-zero 32-byte hex hash (0x…).')
  if (amount && balance.data !== undefined && balance.data < amount) issues.push('Your USDC balance is lower than this amount.')

  const formValid = issues.length === 0
  // Shown whenever an allowance is missing, and disabled (not hidden) while the form is invalid.
  const needsApproval = amount !== undefined && (allowance.data ?? 0n) < amount

  // Re-checked at click time against the chain clock, so a form that was valid a moment ago cannot reach a wallet prompt.
  const blockedNow = () =>
    submissionBlock({ deadlineText, now: data.getNow(), maxDeadlineSeconds: MAX_DEADLINE_SECONDS, amount, maxAmount: MAX_AGREEMENT_RAW })

  const approve = () => {
    const blocked = blockedNow()
    setSubmitBlocked(blocked)
    if (blocked || !amount) return
    approveTx.reset()
    approveTx.send({
      address: usdcToken,
      abi: erc20Abi,
      functionName: 'approve',
      args: [arcsla, amount],
      chainId: CHAIN_ID,
    })
  }

  const fund = () => {
    const blocked = blockedNow()
    setSubmitBlocked(blocked)
    if (blocked || !formValid || !amount || !specHash || !deadlineSeconds) return
    createTx.reset()
    createTx.send({
      address: arcsla,
      abi: arcSlaAbi,
      functionName: 'createAgreement',
      args: [provider as Address, verifier as Address, amount, BigInt(deadlineSeconds), specHash],
      chainId: CHAIN_ID,
    })
  }

  const error = approveTx.error ?? createTx.error
  const done = createTx.isSuccess

  return (
    <>
      <PageHeader
        title="Create agreement"
        subtitle="Lock USDC in escrow for a service. It can only go to the provider with the verifier's signed attestation before the deadline, or back to you after it."
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="space-y-5">
            <Field label="Provider wallet" hint="Receives the USDC when fulfillment is attested.">
              <input className="input mono" placeholder="0x…" value={provider} onChange={(e) => setProvider(e.target.value.trim())} spellCheck={false} />
            </Field>
            <Field label="Verifier wallet" hint="Trusted to sign the fulfillment attestation. Should be independent of both parties.">
              <input className="input mono" placeholder="0x…" value={verifier} onChange={(e) => setVerifier(e.target.value.trim())} spellCheck={false} />
            </Field>

            <div>
              <label className="label" htmlFor="amount">Amount</label>
              <div className="inner mt-1.5 p-4">
                <input
                  id="amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmountText(v)
                  }}
                  placeholder="0.00"
                  className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
                />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--subtle)' }}>USDC</span>
                  <button
                    type="button"
                    disabled={balance.data === undefined}
                    onClick={() => balance.data !== undefined && setAmountText(fmtUsdc(balance.data).replace(/,/g, ''))}
                    className="font-semibold disabled:opacity-40"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    {balance.data !== undefined ? `Balance: ${fmtUsdc(balance.data)} · Max` : gate.isConnected ? 'Reading balance…' : 'Connect to see balance'}
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                Gas on Arc is also paid in USDC from the same balance, so keep a little extra.
              </p>
            </div>

            <Field label="Deadline" hint="Release is possible until this time (inclusive). The customer can refund after it.">
              <DeadlineField
                value={deadlineText}
                onChange={(next) => {
                  setDeadlineText(next)
                  setSubmitBlocked(undefined)
                }}
                now={data.now}
                maxSeconds={MAX_DEADLINE_SECONDS}
              />
            </Field>

            <div>
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="spec">Service specification</label>
                <div className="inline-flex rounded-xl p-0.5" style={{ background: 'var(--surface-muted)' }}>
                  {(['describe', 'hash'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className="rounded-[10px] px-3 py-1.5 text-xs font-semibold"
                      style={{ background: mode === m ? '#fff' : 'transparent', color: mode === m ? 'var(--ink)' : 'var(--muted)' }}
                    >
                      {m === 'describe' ? 'Describe & hash' : 'I have a hash'}
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'describe' ? (
                <textarea
                  id="spec"
                  rows={4}
                  className="input mt-1.5"
                  placeholder="e.g. Deliver 500 labelled images in COCO format by the deadline, ≥98% label accuracy on the agreed audit sample."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              ) : (
                <input id="spec" className="input mono mt-1.5" placeholder="0x… (32 bytes)" value={manualHash} onChange={(e) => setManualHash(e.target.value)} spellCheck={false} />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
                <span>keccak256:</span>
                {specHash ? <HashChip hash={specHash} /> : <span>—</span>}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
                Only the hash goes onchain. Keep the exact text: the verifier and provider need it to check against the hash.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <Card>
            <h2 className="display text-xl font-semibold">Review & fund</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Summary label="Escrow" value={amount ? `${fmtUsdc(amount)} USDC` : '—'} />
              <Summary label="Network" value={CHAIN.name} />
              <Summary label="Allowance" value={allowance.data !== undefined ? `${fmtUsdc(allowance.data)} USDC` : '—'} />
              <Summary label="Platform fee" value="None" />
            </dl>

            {issues.length > 0 && (gate.isConnected || provider || verifier || amountText) && (
              <ul className="mt-4 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                {issues.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
            )}

            <div className="mt-5 space-y-2.5">
              {needsApproval ? (
                <TxButton className="w-full" label="1 · Allow USDC for this agreement" onClick={approve} disabled={!formValid} pending={approveTx.isPending} confirming={approveTx.isConfirming} />
              ) : (
                <TxButton className="w-full" label="Create & fund agreement" onClick={fund} disabled={!formValid} pending={createTx.isPending} confirming={createTx.isConfirming} />
              )}
              {needsApproval && (
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Step 1 of 2. You approve exactly this amount, then fund in the next step. ArcSLA never receives more than you approve.
                </p>
              )}
              {approveTx.isSuccess && !needsApproval && <Notice tone="success">Allowance confirmed. You can fund the agreement now.</Notice>}
              {approveTx.hash && approveTx.isSuccess && <TxLink hash={approveTx.hash}>Allowance transaction</TxLink>}
            </div>

            {submitBlocked && <div className="mt-3"><Notice tone="error">Nothing was sent. {submitBlocked}</Notice></div>}
            {error && <div className="mt-3"><Notice tone="error">{parseOnchainError(error)}</Notice></div>}
            {createTx.isReverted && <div className="mt-3"><Notice tone="error">The transaction was mined but reverted. No funds moved.</Notice></div>}
          </Card>

          {done && createTx.hash && (
            <Card>
              <div className="flex items-center gap-2" style={{ color: 'var(--success)' }}>
                <CheckCircle2 className="size-5" />
                <h3 className="display text-lg font-semibold">Agreement funded</h3>
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                {createdId !== undefined ? `Agreement #${createdId.toString()} is active and the USDC is in escrow.` : 'Your USDC is in escrow.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {createdId !== undefined && (
                  <Link to={`/agreement/${createdId}`} className="btn btn-primary">
                    Open agreement
                  </Link>
                )}
                <TxLink hash={createTx.hash} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs" style={{ color: 'var(--subtle)' }}>{hint}</p>}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt style={{ color: 'var(--muted)' }}>{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
