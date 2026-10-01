import type { Day, Elbow, Exercise, Library, LibraryEntry } from '../plan/schema'
import type { ElbowLevel, SessionLog } from '../state/types'

/** Library/exercise key of the pre-session elbow check. */
export const CHECK_KEY = 'check-gomito'

/** Used when the plan has `elbow: null`. */
export const DEFAULT_ELBOW: Elbow = {
  green_max: 3,
  yellow_max: 5,
  rules: { green: null, yellow: null, red: null, stop: null },
}

/**
 * Traffic light for a 0-10 pain score:
 * green: score <= green_max; yellow: green_max < score <= yellow_max; red: score > yellow_max.
 * `elbow` null -> DEFAULT_ELBOW. A non-finite score fails both comparisons and is treated as red.
 */
export function elbowLevel(score: number, elbow: Elbow | null): ElbowLevel {
  const { green_max, yellow_max } = elbow ?? DEFAULT_ELBOW
  if (score <= green_max) return 'green'
  if (score <= yellow_max) return 'yellow'
  return 'red'
}

/** True when the day contains an exercise with key CHECK_KEY. */
export function dayHasElbowCheck(day: Day): boolean {
  return day.exercises.some((e) => e.key === CHECK_KEY)
}

/**
 * Level that drives the session transform:
 * - session.elbowOverride when set (manual override wins);
 * - otherwise elbowLevel(session.elbowPre) when a score exists;
 * - otherwise null (no score yet / no session: no transform).
 */
export function sessionElbowLevel(
  session: Pick<SessionLog, 'elbowPre' | 'elbowOverride'> | null | undefined,
  elbow: Elbow | null,
): ElbowLevel | null {
  if (!session) return null
  if (session.elbowOverride) return session.elbowOverride
  if (session.elbowPre != null) return elbowLevel(session.elbowPre, elbow)
  return null
}

export type HiddenReason = 'yellow-skip' | 'red-hanging'

export interface EffectiveExercise {
  /** Position in day.exercises (0-based) — the stable id used in SessionLog.exercises. */
  index: number
  ex: Exercise
  lib: LibraryEntry | null
  /** Hidden by the elbow rules for this level. */
  hidden: boolean
  hiddenReason: HiddenReason | null
  /** Effective sets after the transform (null when the exercise has no sets, e.g. info). */
  sets: number | null
  /** Effective sets_max after the transform (>= sets when both are numbers). */
  setsMax: number | null
  /** True when sets were halved by on_yellow "halve". */
  halved: boolean
}

const half = (n: number | null): number | null => (n == null ? null : Math.ceil(n / 2))

/** setsMax never below sets (a plan with sets_max < sets is read as sets_max = sets). */
const atLeast = (max: number | null, sets: number | null): number | null =>
  max != null && sets != null ? Math.max(max, sets) : max

function effective(index: number, ex: Exercise, lib: LibraryEntry | null, level: ElbowLevel | null): EffectiveExercise {
  const base: EffectiveExercise = {
    index,
    ex,
    lib,
    hidden: false,
    hiddenReason: null,
    sets: ex.sets,
    setsMax: atLeast(ex.sets_max, ex.sets),
    halved: false,
  }
  if (!lib?.hanging || level == null || level === 'green') return base
  if (level === 'red') return { ...base, hidden: true, hiddenReason: 'red-hanging' }
  // yellow
  if (lib.on_yellow === 'skip') return { ...base, hidden: true, hiddenReason: 'yellow-skip' }
  if (lib.on_yellow === 'halve') {
    const sets = half(ex.sets)
    const setsMax = atLeast(half(ex.sets_max), sets)
    return { ...base, sets, setsMax, halved: sets != null || setsMax != null }
  }
  return base
}

/**
 * Applies the elbow rules to a day (pure, keeps the original order, never drops items:
 * hidden ones are flagged so the UI can list them).
 * - level null or 'green': nothing changes.
 * - 'yellow': exercises whose library entry has hanging=true:
 *     on_yellow 'skip'  -> hidden (hiddenReason 'yellow-skip');
 *     on_yellow 'halve' -> sets = ceil(sets/2), setsMax = max(ceil(sets_max/2), sets), halved=true;
 *     on_yellow null    -> unchanged.
 * - 'red': every exercise whose library entry has hanging=true is hidden ('red-hanging').
 * Exercises without a library entry are never transformed.
 * Hidden exercises keep their plan sets (for display); they count 0 planned sets.
 */
export function applyElbow(day: Day, library: Library, level: ElbowLevel | null): EffectiveExercise[] {
  return day.exercises.map((ex, index) => effective(index, ex, libraryEntry(library, ex.key), level))
}

/** library[key] or null. Own keys only: a plan key like "constructor" never hits Object.prototype. */
export function libraryEntry(library: Library, key: string): LibraryEntry | null {
  return Object.prototype.hasOwnProperty.call(library, key) ? library[key] : null
}

/** Non-blank text or null. */
const text = (s: string | null | undefined): string | null => (s && s.trim() ? s : null)

/** elbow.rules text for the level (green/yellow/red), or null. */
export function rulesText(elbow: Elbow | null, level: ElbowLevel): string | null {
  return text(elbow?.rules[level])
}

/** elbow.rules.stop, or null. Always shown in the check dialog. */
export function stopRule(elbow: Elbow | null): string | null {
  return text(elbow?.rules.stop)
}

const LABELS: Record<ElbowLevel, string> = { green: 'verde', yellow: 'giallo', red: 'rosso' }
const EMOJIS: Record<ElbowLevel, string> = { green: '🟢', yellow: '🟡', red: '🔴' }

/** Italian label: "verde" | "giallo" | "rosso". */
export function levelLabel(level: ElbowLevel): string {
  return LABELS[level]
}

/** Emoji traffic light: 🟢 🟡 🔴. */
export function levelEmoji(level: ElbowLevel): string {
  return EMOJIS[level]
}
