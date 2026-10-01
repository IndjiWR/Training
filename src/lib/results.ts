import type { Exercise, Unit } from '../plan/schema'
import type { ExerciseLog, SessionLog, SetLog, SideLog } from '../state/types'

/**
 * Library keys of timed sprint tests (e.g. "test-30m", "Sprint 30 m da fermo … Più basso è meglio"):
 * their result is a time in seconds where lower is better.
 */
const TIMED_SPRINT_KEY = /^test-\d+m$/

/**
 * Direction of "best": pain scores (measure "0-10") and timed sprint tests (`key` like "test-30m")
 * are better when lower; everything else (reps, seconds held, cm, metres) is better when higher.
 */
export function lowerIsBetter(unit: Unit | null, measure: string | null, key?: string): boolean {
  if (measure === '0-10') return true
  const seconds = measure === 's' || (measure == null && unit === 's')
  return seconds && key != null && TIMED_SPRINT_KEY.test(key)
}

/** True when the set counts as done (per_side: both sides done). */
export function isSetDone(set: SetLog, perSide: boolean): boolean {
  if (perSide) return Boolean(set.dx?.done && set.sx?.done)
  return set.done
}

/** Number of done sets in the log. */
export function setsDone(log: ExerciseLog | undefined): number {
  if (!log) return 0
  let n = 0
  for (const set of log.sets) if (isSetDone(set, log.perSide)) n++
  return n
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Value of a done side, else null. */
const sideValue = (side: SideLog | undefined): number | null => (side?.done && isNum(side.value) ? side.value : null)

/** Value of a done (non per_side) set, else null. */
const setValue = (set: SetLog): number | null => (set.done && isNum(set.value) ? set.value : null)

/**
 * All numeric values recorded in done sets, in set order (per_side: dx then sx of every set; a side
 * counts as soon as that side is done, so a lone dx result is not lost).
 */
export function recordedValues(log: ExerciseLog): number[] {
  const out: number[] = []
  for (const set of log.sets) {
    if (log.perSide) {
      const dx = sideValue(set.dx)
      const sx = sideValue(set.sx)
      if (dx != null) out.push(dx)
      if (sx != null) out.push(sx)
    } else {
      const v = setValue(set)
      if (v != null) out.push(v)
    }
  }
  return out
}

export interface BestResult {
  /** Best over every recorded value (per_side: over both sides). */
  best: number | null
  /** per_side only: best per side. */
  dx: number | null
  sx: number | null
  /** Index of the best set (for highlighting), -1 if none. */
  bestSetIndex: number
}

const EMPTY_BEST: BestResult = { best: null, dx: null, sx: null, bestSetIndex: -1 }

/**
 * Best result of an exercise log, honouring lowerIsBetter(log.unit, log.measure, log.key).
 * Ties keep the earliest set. per_side: dx/sx are the per-side bests, best/bestSetIndex the best side.
 */
export function bestResult(log: ExerciseLog | undefined): BestResult {
  if (!log) return { ...EMPTY_BEST }
  const lower = lowerIsBetter(log.unit, log.measure, log.key)
  const better = (a: number, b: number | null) => b == null || (lower ? a < b : a > b)

  let best: number | null = null
  let bestSetIndex = -1
  let dx: number | null = null
  let sx: number | null = null

  for (let i = 0; i < log.sets.length; i++) {
    const set = log.sets[i]
    const values: number[] = []
    if (log.perSide) {
      const d = sideValue(set.dx)
      const s = sideValue(set.sx)
      if (d != null) {
        values.push(d)
        if (better(d, dx)) dx = d
      }
      if (s != null) {
        values.push(s)
        if (better(s, sx)) sx = s
      }
    } else {
      const v = setValue(set)
      if (v != null) values.push(v)
    }
    for (const v of values) {
      if (better(v, best)) {
        best = v
        bestSetIndex = i
      }
    }
  }

  return { best, dx, sx, bestSetIndex }
}

export interface LatestResult {
  value: number
  date: string
  index: number
  /** per_side log: best of each side (null when that side has no value, or the log is not per_side). */
  dx: number | null
  sx: number | null
}

/** Kinds whose sets are results (a max test or the best of several attempts). */
const RESULT_KINDS: ReadonlySet<ExerciseLog['kind']> = new Set(['max', 'attempts'])

/**
 * Latest result recorded for `key`: scans every session (any plan), considering only
 * exercise logs with that key and kind 'max' or 'attempts' that have at least one recorded
 * value. "Latest" = greatest (date, index). The result value is that log's bestResult().best
 * (per_side: the best side), with the per-side bests in dx/sx.
 * `before` (optional) excludes logs at or after that position — used so an exercise never
 * reads its own result and only results recorded earlier (same day earlier index, or an earlier
 * date) count.
 */
export function latestResult(
  sessions: Record<string, SessionLog>,
  key: string,
  before?: { date: string; index: number },
): LatestResult | null {
  let latest: LatestResult | null = null
  for (const [sessionKey, session] of Object.entries(sessions)) {
    if (!session?.exercises) continue
    const date = session.date || sessionKey
    if (before && date > before.date) continue
    if (latest && date < latest.date) continue
    for (const log of Object.values(session.exercises)) {
      if (!log || log.key !== key || !RESULT_KINDS.has(log.kind)) continue
      if (before && date === before.date && log.index >= before.index) continue
      if (latest && date === latest.date && log.index <= latest.index) continue
      const { best, dx, sx } = bestResult(log)
      if (best == null) continue
      latest = { value: best, date, index: log.index, dx, sx }
    }
  }
  return latest
}

/** Reps for target_min% and target_max% of `base`. */
export interface PercentRange {
  min: number
  max: number
  base: number
}

export interface PercentMaxTarget {
  /** Reps for target_min% and target_max% (equal when the plan gives a single %). */
  min: number
  max: number
  /** Base result used (the latest max) and when it was recorded. */
  base: number
  baseDate: string
  pctMin: number
  pctMax: number
  /**
   * per_side exercise whose latest max was recorded per side: the target of each side from its own
   * max (a side without any value uses the overall best). min/max/base above are then the
   * weaker side's, so a reader that ignores `sides` never overloads the weaker side. Null otherwise.
   */
  sides: Record<'dx' | 'sx', PercentRange> | null
}

/** round(pct/100 × base), half up. Multiplies first so integer inputs round exactly (70% of 15 -> 11). */
export function percentOf(pct: number, base: number): number {
  return Math.round((pct * base) / 100)
}

/**
 * For exercises with unit '%max': reps = round(pct × latest result recorded for the same key)
 * using latestResult(sessions, ex.key, { date, index }). target_min/target_max are the
 * percentages (one may be null: use the other). Returns null when the exercise is not %max,
 * has no percentage, or there is no positive latest result -> the UI shows ex.dose text instead.
 * per_side: see PercentMaxTarget.sides.
 */
export function resolvePercentMax(
  ex: Exercise,
  sessions: Record<string, SessionLog>,
  at: { date: string; index: number },
): PercentMaxTarget | null {
  if (ex.unit !== '%max') return null
  const a = ex.target_min ?? ex.target_max
  const b = ex.target_max ?? ex.target_min
  if (!isNum(a) || !isNum(b)) return null
  const latest = latestResult(sessions, ex.key, at)
  if (!latest || !(latest.value > 0)) return null
  const pctMin = Math.min(a, b)
  const pctMax = Math.max(a, b)
  const range = (base: number): PercentRange => ({ min: percentOf(pctMin, base), max: percentOf(pctMax, base), base })
  // A side never recorded uses the overall best; a recorded 0 stays 0 (no reps for that side).
  const sideBase = (v: number | null) => v ?? latest.value
  const sides =
    ex.per_side && (latest.dx != null || latest.sx != null)
      ? { dx: range(sideBase(latest.dx)), sx: range(sideBase(latest.sx)) }
      : null
  const main = sides ? (sides.sx.base < sides.dx.base ? sides.sx : sides.dx) : range(latest.value)
  return { ...main, baseDate: latest.date, pctMin, pctMax, sides }
}
