/**
 * Deadline and amount rules for creating an agreement. Pure functions with no network or wallet access,
 * shared by the form (what the user sees) and by the submit handlers (what is allowed to reach a wallet),
 * so the two can never disagree. The contract itself only requires deadline > block.timestamp; the
 * maximum and the minimum lead here are interface safety rails.
 */

/** The deadline must be at least this far in the future when the form is valid and when a transaction is prepared. */
export const MIN_LEAD_SECONDS = 30

/** Above this the form warns that funds stay locked for a long time (no maximum is enforced on testnet). */
export const LONG_DEADLINE_WARNING_SECONDS = 30 * 86400

export interface DeadlinePreset {
  label: string
  seconds: number
}

export const BASE_PRESETS: readonly DeadlinePreset[] = [
  { label: '10 min', seconds: 600 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
]

export interface PresetState extends DeadlinePreset {
  allowed: boolean
  /** Why it is unavailable (set only when `allowed` is false). */
  reason?: string
}

/** "2 hours", "1 hour", "90 minutes", "45 seconds". */
export function formatDuration(totalSeconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (totalSeconds % 3600 === 0) return plural(totalSeconds / 3600, 'hour')
  if (totalSeconds % 60 === 0) return plural(totalSeconds / 60, 'minute')
  return plural(totalSeconds, 'second')
}

/** Local-time value for an <input type="datetime-local">, floored to the minute. */
export function toLocalInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Epoch seconds for a datetime-local value, or undefined when empty or not a real date. */
export function parseDeadlineInput(text: string): number | undefined {
  if (!text) return undefined
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/**
 * The preset buttons for a configuration. With a maximum, presets longer than it are marked unavailable and a
 * preset for the maximum itself is added, so the longest allowed deadline is always one click away.
 */
export function presetsFor(maxSeconds?: number): PresetState[] {
  const states: PresetState[] = BASE_PRESETS.map((p) => {
    const allowed = maxSeconds === undefined || p.seconds <= maxSeconds
    return allowed ? { ...p, allowed } : { ...p, allowed, reason: `Longer than the ${formatDuration(maxSeconds)} maximum for this configuration.` }
  })
  if (maxSeconds !== undefined && maxSeconds >= MIN_LEAD_SECONDS * 2 && !BASE_PRESETS.some((p) => p.seconds === maxSeconds)) {
    states.push({ label: `${formatDuration(maxSeconds)} (max)`, seconds: maxSeconds, allowed: true })
  }
  return states.sort((a, b) => a.seconds - b.seconds)
}

/** Deadline text for a preset, or undefined when the preset is not allowed (so a click can never set it). */
export function presetDeadlineText(preset: PresetState, now: number): string | undefined {
  return preset.allowed ? toLocalInput(now + preset.seconds) : undefined
}

/** The error to show for a deadline, or undefined when it is acceptable right now. */
export function deadlineError(deadline: number | undefined, now: number, maxSeconds?: number): string | undefined {
  if (deadline === undefined) return 'Choose a deadline.'
  if (deadline <= now + MIN_LEAD_SECONDS) return `The deadline must be at least ${MIN_LEAD_SECONDS} seconds in the future.`
  if (maxSeconds !== undefined && deadline - now > maxSeconds) {
    return `The deadline is too far away. This configuration allows at most ${formatDuration(maxSeconds)} from now.`
  }
  return undefined
}

export interface SubmissionCheck {
  /** Raw datetime-local value currently in the form. */
  deadlineText: string
  /** Current chain time in seconds, read at the moment of the click (not at render time). */
  now: number
  maxDeadlineSeconds?: number
  amount?: bigint
  maxAmount?: bigint
}

/**
 * Last check before an approval or a create transaction is prepared. Returns why the action must not
 * proceed, or undefined when it may. Both actions use the same rules.
 */
export function submissionBlock(check: SubmissionCheck): string | undefined {
  const dl = deadlineError(parseDeadlineInput(check.deadlineText), check.now, check.maxDeadlineSeconds)
  if (dl) return dl
  if (check.amount === undefined || check.amount <= 0n) return 'Enter an amount greater than zero.'
  if (check.maxAmount !== undefined && check.amount > check.maxAmount) return 'The amount is above the maximum for this configuration.'
  return undefined
}
