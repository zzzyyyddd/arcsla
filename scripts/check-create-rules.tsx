/**
 * Offline tests for the Create form's deadline and amount rules. No RPC, no wallet, nothing signed or sent.
 *   bun run scripts/check-create-rules.tsx
 * Covers the preset buttons, manual deadline input (inline error), and the checks that block approval and create.
 */
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeadlineField } from '../src/components/DeadlineField'
import { deadlineError, presetDeadlineText, presetsFor, submissionBlock, toLocalInput, MIN_LEAD_SECONDS } from '../src/lib/deadline'

const NOW = 1_800_000_000 // fixed "chain time" so every case is deterministic
const MAINNET_MAX = 2 * 3600 // VITE_MAX_DEADLINE_HOURS=2
const CAP = 10_000n // VITE_MAX_AGREEMENT_USDC=0.01
let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('PASS', name)
}

const render = (value: string, maxSeconds?: number) => renderToStaticMarkup(<DeadlineField value={value} onChange={() => {}} now={NOW} maxSeconds={maxSeconds} />)
/** The <button ...> tags of the rendered presets keyed by their label text. */
function presetButtons(html: string): Record<string, { disabled: boolean; title?: string }> {
  const out: Record<string, { disabled: boolean; title?: string }> = {}
  for (const m of html.matchAll(/<button([^>]*)>\+([^<]*)<\/button>/g)) {
    out[m[2]] = { disabled: /\sdisabled(=|\s|>|$)/.test(` ${m[1]} `), title: /title="([^"]*)"/.exec(m[1])?.[1] }
  }
  return out
}
const inHours = (hours: number) => toLocalInput(NOW + Math.round(hours * 3600))

// ---------------------------------------------------------------- preset buttons
test('mainnet (2 h max): 10 min and 1 hour stay enabled; 1 day and 7 days are disabled with a reason', () => {
  const b = presetButtons(render('', MAINNET_MAX))
  assert.equal(b['10 min'].disabled, false)
  assert.equal(b['1 hour'].disabled, false)
  assert.equal(b['1 day'].disabled, true)
  assert.equal(b['7 days'].disabled, true)
  assert.match(b['7 days'].title ?? '', /Longer than the 2 hours maximum/)
})
test('mainnet adds a preset for the maximum itself, enabled', () => {
  const b = presetButtons(render('', MAINNET_MAX))
  assert.equal(b['2 hours (max)']?.disabled, false)
})
test('mainnet explains why longer presets are unavailable', () => {
  assert.match(render('', MAINNET_MAX), /Longer presets are unavailable: this configuration caps deadlines at 2 hours/)
})
test('a disabled preset can never produce a deadline, even if its handler were called', () => {
  const seven = presetsFor(MAINNET_MAX).find((p) => p.label === '7 days')!
  assert.equal(seven.allowed, false)
  assert.equal(presetDeadlineText(seven, NOW), undefined)
  const one = presetsFor(MAINNET_MAX).find((p) => p.label === '1 hour')!
  assert.equal(presetDeadlineText(one, NOW), toLocalInput(NOW + 3600))
})
test('every allowed mainnet preset yields a deadline that passes validation', () => {
  for (const p of presetsFor(MAINNET_MAX).filter((x) => x.allowed)) {
    const text = presetDeadlineText(p, NOW)!
    assert.equal(deadlineError(Math.floor(new Date(text).getTime() / 1000), NOW, MAINNET_MAX), undefined, p.label)
  }
})
test('testnet (no maximum): all four presets enabled, no extra preset, no cap note', () => {
  const html = render('', undefined)
  const b = presetButtons(html)
  assert.deepEqual(Object.keys(b), ['10 min', '1 hour', '1 day', '7 days'])
  assert.ok(Object.values(b).every((x) => !x.disabled))
  assert.doesNotMatch(html, /Longer presets are unavailable/)
  assert.equal(presetsFor(undefined).length, 4)
})
test('a very small maximum disables everything above it and still offers the maximum', () => {
  const b = presetButtons(render('', 5 * 60))
  assert.equal(b['10 min'].disabled, true)
  assert.equal(b['5 minutes (max)']?.disabled, false)
})

// ---------------------------------------------------------------- manual deadline input
test('mainnet: a manually entered 7-day deadline shows an inline error immediately', () => {
  const html = render(inHours(7 * 24), MAINNET_MAX)
  assert.match(html, /role="alert"/)
  assert.match(html, /too far away\. This configuration allows at most 2 hours from now/)
  assert.match(html, /aria-invalid="true"/)
})
test('mainnet: 2 hours is accepted, 2 hours plus a minute is rejected', () => {
  assert.doesNotMatch(render(inHours(2), MAINNET_MAX), /role="alert"/)
  assert.match(render(toLocalInput(NOW + MAINNET_MAX + 120), MAINNET_MAX), /too far away/)
})
test('mainnet: 1 hour shows no error', () => {
  assert.doesNotMatch(render(inHours(1), MAINNET_MAX), /role="alert"/)
})
test('a deadline in the past shows an inline error on every network', () => {
  assert.match(render(toLocalInput(NOW - 3600), MAINNET_MAX), /at least 30 seconds in the future/)
  assert.match(render(toLocalInput(NOW - 3600), undefined), /at least 30 seconds in the future/)
})
test('an empty field shows no alert yet (the form still lists "Choose a deadline")', () => {
  assert.doesNotMatch(render('', MAINNET_MAX), /role="alert"/)
  assert.equal(deadlineError(undefined, NOW, MAINNET_MAX), 'Choose a deadline.')
})
test('testnet behaviour is preserved: a 7-day deadline is valid and a 31-day one only warns', () => {
  assert.doesNotMatch(render(inHours(7 * 24), undefined), /role="alert"/)
  const long = render(inHours(31 * 24), undefined)
  assert.doesNotMatch(long, /role="alert"/)
  assert.match(long, /more than 30 days away/)
  assert.equal(deadlineError(NOW + 7 * 86400, NOW, undefined), undefined)
})
test('the native picker is limited to the maximum on mainnet and unlimited on testnet', () => {
  assert.match(render('', MAINNET_MAX), new RegExp(`max="${toLocalInput(NOW + MAINNET_MAX)}"`))
  assert.doesNotMatch(render('', undefined), /\smax="/)
})

// ---------------------------------------------------------------- transaction blocking (approve and create share these rules)
const base = { now: NOW, maxDeadlineSeconds: MAINNET_MAX, amount: CAP, maxAmount: CAP }
test('approval and create are both blocked for a 7-day deadline on mainnet', () => {
  const block = submissionBlock({ ...base, deadlineText: inHours(7 * 24) })
  assert.match(block ?? '', /too far away/)
})
test('they are allowed for a 1-hour deadline at exactly the 0.01 USDC cap', () => {
  assert.equal(submissionBlock({ ...base, deadlineText: inHours(1) }), undefined)
})
test('the deadline is re-checked against the clock at click time: valid at render, invalid a minute later', () => {
  const text = toLocalInput(NOW + 90)
  assert.equal(submissionBlock({ ...base, deadlineText: text }), undefined)
  const later = submissionBlock({ ...base, deadlineText: text, now: NOW + 90 })
  assert.match(later ?? '', /at least 30 seconds in the future/)
  assert.equal(MIN_LEAD_SECONDS, 30)
})
test('an empty or unparseable deadline blocks', () => {
  assert.equal(submissionBlock({ ...base, deadlineText: '' }), 'Choose a deadline.')
  assert.equal(submissionBlock({ ...base, deadlineText: 'not-a-date' }), 'Choose a deadline.')
})
test('the mainnet 0.01 USDC amount cap still blocks (and zero or missing amounts block)', () => {
  assert.match(submissionBlock({ ...base, deadlineText: inHours(1), amount: 10_001n }) ?? '', /above the maximum/)
  assert.match(submissionBlock({ ...base, deadlineText: inHours(1), amount: undefined }) ?? '', /greater than zero/)
  assert.match(submissionBlock({ ...base, deadlineText: inHours(1), amount: 0n }) ?? '', /greater than zero/)
})
test('testnet: no maximum, no amount cap', () => {
  assert.equal(submissionBlock({ deadlineText: inHours(7 * 24), now: NOW, amount: 5_000_000_000n }), undefined)
})

// ---------------------------------------------------------------- the real form is wired to those rules
const source = readFileSync(new URL('../src/pages/Create.tsx', import.meta.url), 'utf8')
const body = (name: string) => {
  const start = source.indexOf(`const ${name} = () => {`)
  assert.ok(start > -1, `${name} not found`)
  return source.slice(start, source.indexOf('\n  }\n', start))
}
test('Create.tsx has exactly one approval send and one create send, each after the click-time check', () => {
  assert.equal(source.split('approveTx.send(').length - 1, 1)
  assert.equal(source.split('createTx.send(').length - 1, 1)
  const approve = body('approve')
  const fund = body('fund')
  assert.ok(approve.indexOf('blockedNow()') > -1 && approve.indexOf('blockedNow()') < approve.indexOf('approveTx.send('))
  assert.ok(fund.indexOf('blockedNow()') > -1 && fund.indexOf('blockedNow()') < fund.indexOf('createTx.send('))
  assert.match(approve, /if \(blocked \|\| !amount\) return/)
  assert.match(fund, /if \(blocked \|\| !formValid/)
})
test('Create.tsx reads the clock at click time and both buttons are disabled while the form is invalid', () => {
  assert.match(source, /now: data\.getNow\(\)/)
  assert.match(source, /label="1 · Allow USDC for this agreement"[^>]*disabled=\{!formValid\}/)
  assert.match(source, /label="Create & fund agreement"[^>]*disabled=\{!formValid\}/)
  assert.match(source, /<DeadlineField[\s\S]*maxSeconds=\{MAX_DEADLINE_SECONDS\}/)
  assert.match(source, /deadlineError\(deadlineSeconds, data\.now, MAX_DEADLINE_SECONDS\)/)
})

console.log(`\n${passed} create-form rule tests passed. Nothing was sent or signed.`)
