import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ElbowLevel } from '../state/types'
import { IconClose, IconMinus, IconPlus } from './icons'

/* ───────────────────────── Sheet (modal bottom sheet) ───────────────────────── */

export interface SheetProps {
  open: boolean
  title: string
  onClose?: () => void
  /** When false, backdrop tap / Escape do nothing and no close button is shown. */
  dismissable?: boolean
  children: ReactNode
}

export function Sheet({ open, title, onClose, dismissable = true, children }: SheetProps) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  // Kept in a ref: an inline onClose must not re-run the effect (it would steal focus from inputs).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissableRef = useRef(dismissable)
  dismissableRef.current = dismissable

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissableRef.current) onCloseRef.current?.()
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose?.()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <div className="sheet__head">
          <h2 id={titleId}>{title}</h2>
          {dismissable && onClose && (
            <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Chiudi">
              <IconClose />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

/* ───────────────────────── ScoreGrid (0-10 / 1-10) ───────────────────────── */

export interface ScoreGridProps {
  label: string
  value: number | null
  onChange: (value: number) => void
  min?: number
  max?: number
  /** Optional traffic light per score (elbow pain). */
  levelFor?: (n: number) => ElbowLevel | undefined
}

export function ScoreGrid({ label, value, onChange, min = 0, max = 10, levelFor }: ScoreGridProps) {
  const scores = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div role="group" aria-label={label} className="score-grid">
      {scores.map((n) => (
        <button
          key={n}
          type="button"
          className="btn"
          aria-pressed={value === n}
          data-level={levelFor?.(n)}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

/* ───────────────────────── Stepper (+/−) ───────────────────────── */

export interface StepperProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}

export function Stepper({ label, value, onChange, min = 0, max = 999, step = 1, unit }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="btn"
        aria-label={`${label}: meno`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <IconMinus />
      </button>
      <output className="stepper__value" aria-live="polite">
        {value}
        {unit && <span className="stepper__unit">{unit}</span>}
      </output>
      <button
        type="button"
        className="btn"
        aria-label={`${label}: più`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <IconPlus />
      </button>
    </div>
  )
}

/* ───────────────────────── NumberField (accepts "73,5") ───────────────────────── */

/** Parses "73,5" / "73.5" / "" -> 73.5 / null. Returns NaN for garbage. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN
}

/** 73.5 -> "73,5" (Italian decimal comma), null -> "". */
export function formatDecimal(value: number | null | undefined, maxDecimals = 1): string {
  if (value == null || Number.isNaN(value)) return ''
  const factor = 10 ** maxDecimals
  return String(Math.round(value * factor) / factor).replace('.', ',')
}

export interface NumberFieldProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  min?: number
  max?: number
  /** "decimal" shows the comma keypad, "numeric" digits only. */
  inputMode?: 'decimal' | 'numeric'
  placeholder?: string
  maxDecimals?: number
}

/** Text input committing a number on blur/Enter. Invalid or out-of-range text is rejected. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  inputMode = 'decimal',
  placeholder,
  maxDecimals = 1,
}: NumberFieldProps) {
  const id = useId()
  const [text, setText] = useState(formatDecimal(value, maxDecimals))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(formatDecimal(value, maxDecimals))
  }, [value, maxDecimals])

  const commit = () => {
    const n = parseDecimal(text)
    if (n === null) {
      setError(null)
      if (value !== null) onChange(null)
      return
    }
    if (Number.isNaN(n) || (min != null && n < min) || (max != null && n > max)) {
      setError(min != null && max != null ? `Valore tra ${min} e ${max}` : 'Numero non valido')
      return
    }
    setError(null)
    if (n !== value) onChange(n)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {unit && <span className="muted">{unit}</span>}
      </div>
      {error && (
        <span role="alert" className="small" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </div>
  )
}
