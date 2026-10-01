import { useId, useState } from 'react'
import { IconCheck, IconClose } from '../icons'
import { formatDecimal, parseDecimal, ScoreGrid, Stepper } from '../ui'

/** Input widgets used inside tracker rows. Primary buttons are full-width, at the bottom. */

export interface ConfirmButtonProps {
  label?: string
  /** Accessible name when the visible label is short (e.g. "Fatto dx"). */
  ariaLabel?: string
  onClick: () => void
  disabled?: boolean
}

/** Big "✓ Fatto" button. */
export function ConfirmButton({ label = 'Fatto', ariaLabel, onClick, disabled }: ConfirmButtonProps) {
  return (
    <button
      type="button"
      className="btn btn--ok btn--big btn--block"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <IconCheck /> {label}
    </button>
  )
}

export interface CountEntryProps {
  /** Stepper label, e.g. "Ripetizioni serie 2". */
  label: string
  value: number
  unit?: string
  onChange: (value: number) => void
  onConfirm: (value: number) => void
  confirmLabel?: string
  confirmAriaLabel?: string
  /** Extra "−N / +N" buttons for big counts (e.g. 5 for max tests). */
  quickStep?: number
}

const STEPPER_MAX = 999

/** −N / +N row under a stepper. */
function QuickSteps({ label, step, value, onChange }: { label: string; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="ex-quick" role="group" aria-label={`${label}: passi da ${step}`}>
      <button
        type="button"
        className="btn btn--outline"
        aria-label={`${label}: meno ${step}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - step))}
      >
        −{step}
      </button>
      <button
        type="button"
        className="btn btn--outline"
        aria-label={`${label}: più ${step}`}
        disabled={value >= STEPPER_MAX}
        onClick={() => onChange(Math.min(STEPPER_MAX, value + step))}
      >
        +{step}
      </button>
    </div>
  )
}

/** +/− counter (value owned by the parent until confirmed) + big confirm. */
export function CountEntry({
  label,
  value,
  unit,
  onChange,
  onConfirm,
  confirmLabel = 'Fatto',
  confirmAriaLabel,
  quickStep,
}: CountEntryProps) {
  return (
    <div className="ex-entry">
      <Stepper label={label} value={value} onChange={onChange} unit={unit} max={STEPPER_MAX} />
      {quickStep != null && <QuickSteps label={label} step={quickStep} value={value} onChange={onChange} />}
      <ConfirmButton label={confirmLabel} ariaLabel={confirmAriaLabel} onClick={() => onConfirm(value)} />
    </div>
  )
}

export interface CountEditorProps {
  label: string
  initial: number
  unit?: string
  quickStep?: number
  onSave: (value: number) => void
}

/** Edits a recorded count (done row): own stepper state + "Salva". */
export function CountEditor({ label, initial, unit, quickStep, onSave }: CountEditorProps) {
  const [value, setValue] = useState(initial)
  return (
    <div className="ex-entry">
      <Stepper label={label} value={value} onChange={setValue} unit={unit} max={STEPPER_MAX} />
      {quickStep != null && <QuickSteps label={label} step={quickStep} value={value} onChange={setValue} />}
      <button type="button" className="btn btn--primary btn--block" onClick={() => onSave(value)}>
        <IconCheck /> Salva
      </button>
    </div>
  )
}

export interface NumberEntryProps {
  label: string
  unit?: string
  initial: number | null
  inputMode?: 'decimal' | 'numeric'
  min?: number
  max?: number
  saveLabel?: string
  /** Big primary-sized save button (new entries); small for edits. */
  big?: boolean
  /** Focus the field on mount (opened on demand). */
  autoFocus?: boolean
  onSave: (value: number) => void
}

/**
 * Numeric text field + explicit save. The text is kept on every keystroke and parsed on save
 * ("12,5" ok), so tapping "Salva" never depends on the input's blur (unreliable on iOS).
 */
export function NumberEntry({
  label,
  unit,
  initial,
  inputMode = 'decimal',
  min = 0,
  max,
  saveLabel = 'Salva',
  big = false,
  autoFocus = false,
  onSave,
}: NumberEntryProps) {
  const id = useId()
  const errorId = `${id}-err`
  const [text, setText] = useState(formatDecimal(initial))
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    const n = parseDecimal(text)
    if (n === null) {
      setError('Inserisci un valore')
      return
    }
    if (Number.isNaN(n) || n < min || (max != null && n > max)) {
      setError(max != null ? `Valore tra ${min} e ${max}` : 'Numero non valido')
      return
    }
    setError(null)
    onSave(n)
  }

  return (
    <form
      className="ex-entry"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className="input-unit">
          <input
            id={id}
            type="text"
            inputMode={inputMode}
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={autoFocus}
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
          />
          {unit && <span className="muted">{unit}</span>}
        </div>
        {error && (
          <span id={errorId} role="alert" className="small ex-error">
            {error}
          </span>
        )}
      </div>
      <button type="submit" className={`btn ${big ? 'btn--ok btn--big' : 'btn--primary'} btn--block`}>
        <IconCheck /> {saveLabel}
      </button>
    </form>
  )
}

export interface ManualEntryProps {
  label: string
  unit?: string
  onSave: (value: number) => void
}

/** Collapsed "Inserisci a mano" link that opens a NumberEntry (when the timer was not used). */
export function ManualEntry({ label, unit, onSave }: ManualEntryProps) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--block ex-ghost" onClick={() => setOpen(true)}>
        Inserisci a mano
      </button>
    )
  }
  return (
    <div className="ex-manual">
      <NumberEntry label={label} unit={unit} initial={null} inputMode="numeric" big autoFocus onSave={onSave} />
      <button type="button" className="btn btn--ghost btn--block ex-ghost" onClick={() => setOpen(false)}>
        <IconClose /> Chiudi
      </button>
    </div>
  )
}

export interface ScoreEntryProps {
  label: string
  initial: number | null
  saveLabel?: string
  big?: boolean
  onSave: (value: number) => void
}

/** 0-10 grid + save. */
export function ScoreEntry({ label, initial, saveLabel = 'Salva', big = true, onSave }: ScoreEntryProps) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <div className="ex-entry">
      <ScoreGrid label={label} value={value} onChange={setValue} />
      <button
        type="button"
        className={`btn ${big ? 'btn--ok btn--big' : 'btn--primary'} btn--block`}
        disabled={value == null}
        onClick={() => {
          if (value != null) onSave(value)
        }}
      >
        <IconCheck /> {saveLabel}
      </button>
    </div>
  )
}
