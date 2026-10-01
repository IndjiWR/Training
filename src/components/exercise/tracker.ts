import { useCallback, useState, type ReactNode } from 'react'
import type { EffectiveExercise } from '../../lib/elbow'
import { confirmTap } from '../../lib/feedback'
import { formatClock, formatNumberIt, formatValue, toSeconds, unitLabel } from '../../lib/format'
import type { Exercise, LibraryEntry, Unit } from '../../plan/schema'
import { updateSet, updateSide } from '../../state/actions'
import { getState } from '../../state/store'
import { clearTimer, getAllTimers } from '../../state/timers'
import type { ExerciseLog, SetLog } from '../../state/types'
import { startRest } from '../../state/ui'

/** Shared plumbing of the per-kind trackers: targets, set actions (with rest/haptics), drafts. */

export type Side = 'dx' | 'sx'
export const SIDES: readonly Side[] = ['dx', 'sx']
export const SIDE_NAME: Record<Side, string> = { dx: 'destra', sx: 'sinistra' }

/** Which exercise/session a tracker writes to. `rows` = visible rows (for the rest label). */
export interface TrackerTarget {
  date: string
  eff: EffectiveExercise
  rows: number
}

export interface TrackerProps {
  t: TrackerTarget
  log: ExerciseLog | undefined
}

/** How a done set/side is shown: compact text, optional feedback and inline editor. */
export interface DoneView {
  text: string
  feedback?: ReactNode
  /** Inline editor for the recorded value; `close` hides it. */
  editor?: (close: () => void) => ReactNode
}

/* ───────────── reading ───────────── */

export function range(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i)
}

export function isAttemptKind(ex: Exercise): boolean {
  return ex.kind === 'attempts' || ex.kind === 'max'
}

export function valueAt(set: SetLog | undefined, side: Side | null): number | null {
  if (!set) return null
  return side ? (set[side]?.value ?? null) : set.value
}

export function doneAt(set: SetLog | undefined, side: Side | null): boolean {
  if (!set) return false
  return side ? Boolean(set[side]?.done) : set.done
}

/** True when nothing has been confirmed in the set (no side either). */
export function isUntouched(set: SetLog | undefined): boolean {
  return !set || (!set.done && !set.dx?.done && !set.sx?.done)
}

function storedSet(t: TrackerTarget, setIndex: number): SetLog | undefined {
  return getState().sessions[t.date]?.exercises[String(t.eff.index)]?.sets[setIndex]
}

/** Unit of the recorded result: the plan unit, else the library measure ("0-10" = pain). */
export function resultUnit(ex: Exercise, lib: LibraryEntry | null): Unit | string | null {
  return ex.unit ?? lib?.measure ?? null
}

/** Short unit label for rep counters ("rip" for rep / %max / no unit). */
export function repsUnit(ex: Exercise): string {
  return ex.unit == null || ex.unit === 'rep' || ex.unit === '%max' ? 'rip' : unitLabel(ex.unit)
}

/* ───────────── formatting ───────────── */

/** 45 -> "45 s", 75 -> "1:15". */
export function formatSeconds(s: number): string {
  return s < 60 ? `${formatNumberIt(s)} s` : formatClock(s)
}

/** "10–15 s", "8 s", "≥ 10 s"; null when no bound. Values in the plan unit. */
export function formatBand(min: number | null, max: number | null, unit: Unit | string | null): string | null {
  const u = unitLabel(unit)
  const tail = u ? ` ${u}` : ''
  if (min != null && max != null) {
    return min === max || max < min
      ? `${formatNumberIt(min)}${tail}`
      : `${formatNumberIt(min)}–${formatNumberIt(max)}${tail}`
  }
  if (min != null) return `≥ ${formatNumberIt(min)}${tail}`
  if (max != null) return `${formatNumberIt(max)}${tail}`
  return null
}

/** Plan target converted to seconds for timers: min ×60, s as is, no unit = seconds. */
export function targetSeconds(value: number | null, unit: Unit | null): number | null {
  if (value == null) return null
  if (unit == null) return Math.round(value)
  return toSeconds(value, unit)
}

/** Duration choice label: 1200 s -> "20'", 45 s -> 45". Falls back to value + unit. */
export function durationLabel(value: number, unit: Unit | null): string {
  const s = toSeconds(value, unit)
  if (s == null) return formatValue(value, unit)
  if (s >= 60 && s % 60 === 0) return `${s / 60}'`
  return s < 60 ? `${s}"` : formatClock(s)
}

/** The duration option (plan value in `unit`) a countdown of `durationMs` was started with, if any. */
export function optionForDuration(
  options: readonly number[],
  unit: Unit | null,
  durationMs: number | null,
): number | undefined {
  if (durationMs == null) return undefined
  return options.find((o) => {
    const s = toSeconds(o, unit)
    return s != null && Math.round(s * 1000) === durationMs
  })
}

/* ───────────── writing (with rest timer + haptics) ───────────── */

export interface CompleteOptions {
  /** Light vibration on confirm (default true). Timers already give their own feedback. */
  tap?: boolean
}

function onSetCompleted(t: TrackerTarget, setIndex: number): void {
  const { ex } = t.eff
  if (ex.rest_s != null && ex.rest_s > 0) {
    const noun = isAttemptKind(ex) ? 'tentativo' : 'serie'
    startRest({
      seconds: ex.rest_s,
      maxSeconds: ex.rest_max_s,
      label: `${ex.name} · ${noun} ${setIndex + 1}/${Math.max(t.rows, setIndex + 1)}`,
    })
  }
}

/** Confirms a whole set; starts the rest timer when it was not done before. */
export function completeSet(
  t: TrackerTarget,
  setIndex: number,
  value: number | null,
  { tap = true }: CompleteOptions = {},
): void {
  const wasDone = storedSet(t, setIndex)?.done === true
  updateSet(t.date, t.eff.index, setIndex, { done: true, value })
  if (tap) confirmTap()
  if (!wasDone && storedSet(t, setIndex)?.done) onSetCompleted(t, setIndex)
}

/** Confirms one side; the rest starts when this completes the set (both sides done). */
export function completeSide(
  t: TrackerTarget,
  setIndex: number,
  side: Side,
  value: number | null,
  { tap = true }: CompleteOptions = {},
): void {
  const wasDone = storedSet(t, setIndex)?.done === true
  updateSide(t.date, t.eff.index, setIndex, side, { done: true, value })
  if (tap) confirmTap()
  if (!wasDone && storedSet(t, setIndex)?.done) onSetCompleted(t, setIndex)
}

/** Confirms a set or a side. */
export function complete(
  t: TrackerTarget,
  setIndex: number,
  side: Side | null,
  value: number | null,
  opts?: CompleteOptions,
): void {
  if (side) completeSide(t, setIndex, side, value, opts)
  else completeSet(t, setIndex, value, opts)
}

/** Common prefix of every timer id of one exercise (trailing '#': exercise 1 never matches 10). */
export function exerciseTimerPrefix(date: string, index: number): string {
  return `${date}#${index}#`
}

/** Stable timer id of a row/side: `${date}#${index}#${set}` (+ `#dx` / `#sx`). */
export function timerId(t: TrackerTarget, setIndex: number, side: Side | null): string {
  return `${exerciseTimerPrefix(t.date, t.eff.index)}${setIndex}${side ? `#${side}` : ''}`
}

/** Removes every persisted timer (all rows and sides) of exercise `index` of `date`. */
export function clearExerciseTimers(date: string, index: number): void {
  const prefix = exerciseTimerPrefix(date, index)
  for (const id of Object.keys(getAllTimers())) {
    if (id.startsWith(prefix)) clearTimer(id)
  }
}

/** Changes the recorded value of a set/side, keeping its done state. */
export function editValue(t: TrackerTarget, setIndex: number, side: Side | null, value: number | null): void {
  if (side) updateSide(t.date, t.eff.index, setIndex, side, { value })
  else updateSet(t.date, t.eff.index, setIndex, { value })
}

/** Un-confirms a set/side (the value is kept to prefill the entry). */
export function undo(t: TrackerTarget, setIndex: number, side: Side | null): void {
  if (side) updateSide(t.date, t.eff.index, setIndex, side, { done: false })
  else updateSet(t.date, t.eff.index, setIndex, { done: false })
}

/* ───────────── in-progress values (until confirmed) ───────────── */

export const draftKey = (setIndex: number, side: Side | null): string => `${setIndex}:${side ?? '-'}`

/** Per-row values being edited (e.g. stepper) before "Fatto". */
export function useDrafts() {
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const setDraft = useCallback((key: string, value: number) => {
    setDrafts((d) => (d[key] === value ? d : { ...d, [key]: value }))
  }, [])
  const clearDraft = useCallback((key: string) => {
    setDrafts((d) => {
      if (!(key in d)) return d
      const next = { ...d }
      delete next[key]
      return next
    })
  }, [])
  return { drafts, setDraft, clearDraft }
}
