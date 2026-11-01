import {
  LONG_DEADLINE_WARNING_SECONDS,
  deadlineError,
  formatDuration,
  parseDeadlineInput,
  presetDeadlineText,
  presetsFor,
  toLocalInput,
} from '@/lib/deadline'

interface Props {
  value: string
  onChange: (next: string) => void
  /** Current chain time in seconds. */
  now: number
  /** Longest allowed deadline in seconds from now; undefined means no maximum (Arc Testnet). */
  maxSeconds?: number
}

const ERROR_ID = 'deadline-error'
const CAP_NOTE_ID = 'deadline-cap-note'

/**
 * Deadline input with presets. With a maximum configured, presets above it are disabled (not just ignored),
 * a manual value above it shows an inline error straight away, and the native picker is limited to it.
 * Presentational and dependency-free so it can be rendered and tested on its own.
 */
export function DeadlineField({ value, onChange, now, maxSeconds }: Props) {
  const parsed = parseDeadlineInput(value)
  const error = value ? deadlineError(parsed, now, maxSeconds) : undefined
  const presets = presetsFor(maxSeconds)
  const someDisabled = presets.some((p) => !p.allowed)
  const longDeadline = parsed !== undefined && maxSeconds === undefined && parsed - now > LONG_DEADLINE_WARNING_SECONDS

  return (
    <div>
      <input
        type="datetime-local"
        className="input"
        value={value}
        min={toLocalInput(now)}
        max={maxSeconds !== undefined ? toLocalInput(now + maxSeconds) : undefined}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ERROR_ID : someDisabled ? CAP_NOTE_ID : undefined}
      />
      {error && (
        <p id={ERROR_ID} role="alert" className="mt-2 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {longDeadline && (
        <p className="mt-2 text-xs" style={{ color: '#7a4e00' }}>
          This deadline is more than 30 days away. Your USDC stays locked until the verifier attests or the deadline passes; there is no early cancellation.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={!p.allowed}
            title={p.reason}
            className="rounded-full px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            onClick={() => {
              const next = presetDeadlineText(p, now)
              if (next) onChange(next)
            }}
          >
            +{p.label}
          </button>
        ))}
      </div>
      {someDisabled && maxSeconds !== undefined && (
        <p id={CAP_NOTE_ID} className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          Longer presets are unavailable: this configuration caps deadlines at {formatDuration(maxSeconds)} from now.
        </p>
      )}
    </div>
  )
}
