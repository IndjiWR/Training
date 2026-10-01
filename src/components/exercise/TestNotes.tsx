import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { setExerciseText } from '../../state/actions'
import { getState } from '../../state/store'

const SAVE_DELAY_MS = 700

export interface TestNotesProps {
  date: string
  index: number
  /** Stored text (ExerciseLog.text). */
  text: string | undefined
}

/** Free-text result of a test (e.g. front lever progression). Saved while typing (debounced) and on blur. */
export function TestNotes({ date, index, text }: TestNotesProps) {
  const id = useId()
  const [value, setValue] = useState(text ?? '')
  const latest = useRef(value)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow external changes (reset, other tab) unless the user is typing.
  useEffect(() => {
    if (focused.current) return
    latest.current = text ?? ''
    setValue(text ?? '')
  }, [text])

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const stored = getState().sessions[date]?.exercises[String(index)]?.text ?? ''
    if (latest.current !== stored) setExerciseText(date, index, latest.current)
  }, [date, index])

  // Never lose a pending edit when the card collapses.
  useEffect(() => () => flush(), [flush])

  return (
    <div className="field ex-testnotes">
      <label htmlFor={id}>Note del test (es. progressione)</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="Facoltativo"
        value={value}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(e) => {
          setValue(e.target.value)
          latest.current = e.target.value
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(flush, SAVE_DELAY_MS)
        }}
        onBlur={() => {
          focused.current = false
          flush()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}
