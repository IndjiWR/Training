import type { DayType, Elbow } from '../../plan/schema'
import {
  CHECK_KEY,
  elbowLevel,
  isOptional,
  plannedSetCount,
  type EffectiveExercise,
  type HiddenReason,
} from '../../lib/elbow'
import { setsDone } from '../../lib/results'
import { currentPhase, endsAt, type TimerMap } from '../../state/timers'
import type { ElbowLevel, SessionLog } from '../../state/types'

/** Pure helpers of the "Oggi" screen. */

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  TIRATA: 'Tirata',
  SPINTA: 'Spinta',
  GAMBE: 'Gambe',
  RIPOSO: 'Riposo',
}

export const ELBOW_LEVELS: readonly ElbowLevel[] = ['green', 'yellow', 'red']

/** "giovedì 1 ottobre" -> "Giovedì 1 ottobre". */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('it-IT') + text.slice(1) : text
}

/** Plan text worth showing: not null/blank and not a dash placeholder ("—"). */
export function hasText(text: string | null | undefined): text is string {
  if (!text) return false
  const t = text.trim()
  return t !== '' && !/^[-–—]+$/.test(t)
}

/**
 * Sets planned for an exercise after the elbow transform: info and hidden count 0, `sets: null`
 * counts 1 (the card shows one row). Same rule as the session logs and the weekly summary.
 */
export function plannedSets(e: EffectiveExercise): number {
  return plannedSetCount(e)
}

/** Done sets of exercise `index` in the session. */
export function doneSets(session: SessionLog | undefined, index: number): number {
  return setsDone(session?.exercises[String(index)])
}

/** The elbow gate is settled: a score or a manual traffic light is set. */
export function elbowSettled(session: SessionLog | undefined): boolean {
  return session?.elbowPre != null || session?.elbowOverride != null
}

/**
 * Done sets of an effective exercise. The elbow check counts as done once the gate is settled
 * (score or manual colour), even without its set log — as in the weekly summary.
 */
function exerciseDone(e: EffectiveExercise, session: SessionLog | undefined): number {
  const done = doneSets(session, e.index)
  return e.ex.key === CHECK_KEY && elbowSettled(session) ? Math.max(done, 1) : done
}

/** An exercise is complete when its done sets reach the planned ones (info: always). */
export function isComplete(e: EffectiveExercise, session: SessionLog | undefined): boolean {
  if (e.ex.kind === 'info') return true
  return exerciseDone(e, session) >= plannedSets(e)
}

export interface SessionProgress {
  done: number
  planned: number
}

/**
 * "Serie fatte X / Y": over visible, non-info, non-optional exercises (extra sets count as done),
 * the same count as the weekly summary. Optional exercises (block "Opzionale") count in neither.
 */
export function sessionProgress(list: readonly EffectiveExercise[], session: SessionLog | undefined): SessionProgress {
  let done = 0
  let planned = 0
  for (const e of list) {
    if (e.hidden || e.ex.kind === 'info' || isOptional(e.ex)) continue
    planned += plannedSets(e)
    done += exerciseDone(e, session)
  }
  return { done, planned }
}

export function hiddenReasonText(reason: HiddenReason | null): string {
  switch (reason) {
    case 'yellow-skip':
      return 'giallo: salta'
    case 'red-hanging':
      return 'rosso: niente sospensioni'
    default:
      return 'nascosto'
  }
}

/** Banner/badge tone of a traffic light level. */
export function levelTone(level: ElbowLevel): 'ok' | 'warn' | 'danger' {
  return level === 'green' ? 'ok' : level === 'yellow' ? 'warn' : 'danger'
}

export interface LevelRange {
  level: ElbowLevel
  from: number
  to: number
}

/** Integer score ranges of each level, e.g. green 0–3, yellow 4–5, red 6–10. */
export function levelRanges(elbow: Elbow | null): LevelRange[] {
  const ranges: LevelRange[] = []
  for (let n = 0; n <= 10; n++) {
    const level = elbowLevel(n, elbow)
    const last = ranges[ranges.length - 1]
    if (last && last.level === level) last.to = n
    else ranges.push({ level, from: n, to: n })
  }
  return ranges
}

function setsText(sets: number | null, setsMax: number | null): string {
  if (sets == null) return '–'
  return setsMax != null && setsMax > sets ? `${sets}–${setsMax}` : String(sets)
}

export interface ElbowChange {
  index: number
  text: string
}

/**
 * Concrete effect of the elbow level on the day, one line per changed exercise:
 * "Muscle-up: salta oggi", "Front lever (3-4 tentativi): 3–4 → 2 tentativi".
 */
export function elbowChanges(list: readonly EffectiveExercise[]): ElbowChange[] {
  const changed = list.filter((e) => e.hidden || e.halved)
  const labelOf = (e: EffectiveExercise) => e.lib?.label ?? e.ex.name
  return changed.map((e) => {
    const label = labelOf(e)
    const duplicate = changed.some((o) => o !== e && labelOf(o) === label)
    const name = duplicate && hasText(e.ex.dose) ? `${label} (${e.ex.dose})` : label
    if (e.hidden) return { index: e.index, text: `${name}: salta oggi` }
    const noun = e.ex.kind === 'attempts' || e.ex.kind === 'max' ? 'tentativi' : 'serie'
    const before = setsText(e.ex.sets, e.ex.sets_max)
    const after = setsText(e.sets, e.setsMax)
    return { index: e.index, text: `${name}: ${before} → ${after} ${noun}` }
  })
}

/* ───────────────────────── workout in progress (wake lock) ───────────────────────── */

export interface WorkoutClock {
  /** Start (epoch ms) of the open session — started, not finished, not skipped — or null. */
  openSessionStart: number | null
  /** End (epoch ms) of the rest timer, or null when none is running. */
  restEndAt: number | null
  /** Persisted exercise timers (hold count-ups, countdowns, the elbow-check hang). */
  timers: TimerMap
}

/**
 * Until when (epoch ms) a workout is in progress, or null when none is at `now`. Counts:
 * - the open session, for `windowMs` after its start (a forgotten one stops counting);
 * - the rest timer, until its end;
 * - an exercise timer in its 3-2-1 or counting (paused/done ones do not count): a countdown until
 *   its end, a count-up for `windowMs` after it was started.
 * Used for the screen wake lock, so the screen stays on e.g. during the warm-up countdown started
 * before "Inizia sessione", and not forever for a session never closed.
 */
export function workoutActiveUntil(clock: WorkoutClock, now: number, windowMs: number): number | null {
  let until = Number.NEGATIVE_INFINITY
  if (clock.openSessionStart != null) until = clock.openSessionStart + windowMs
  if (clock.restEndAt != null) until = Math.max(until, clock.restEndAt)
  for (const t of Object.values(clock.timers)) {
    const phase = currentPhase(t, now)
    if (phase !== 'prep' && phase !== 'run') continue
    const end = t.mode === 'countdown' ? endsAt(t) : t.createdAt + windowMs
    if (end != null) until = Math.max(until, end)
  }
  return until > now ? until : null
}

/* ───────────────────────── dates ───────────────────────── */

/** Calendar day before an ISO date (UTC arithmetic, so DST never skips a day). Malformed -> null. */
export function previousDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const [y0, m0, d0] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y0, m0 - 1, d0))
  // Reject overflowing dates such as 2026-02-30 or 2026-13-01.
  if (date.getUTCFullYear() !== y0 || date.getUTCMonth() !== m0 - 1 || date.getUTCDate() !== d0) return null
  date.setUTCDate(date.getUTCDate() - 1)
  const y = String(date.getUTCFullYear()).padStart(4, '0')
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * True when `session` is still being trained: started less than `windowMs` before `now`, not
 * finished, not skipped. Used to keep the shown day across midnight during a session.
 */
export function sessionRunning(session: SessionLog | undefined, now: number, windowMs: number): boolean {
  if (!session?.startedAt || session.finishedAt || session.skipped) return false
  const started = Date.parse(session.startedAt)
  return !Number.isNaN(started) && now - started < windowMs
}
