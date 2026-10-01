import type { DayType, Elbow } from '../../plan/schema'
import { elbowLevel, type EffectiveExercise, type HiddenReason } from '../../lib/elbow'
import { setsDone } from '../../lib/results'
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

/** Sets planned for an exercise after the elbow transform (info and hidden count 0). */
export function plannedSets(e: EffectiveExercise): number {
  if (e.hidden || e.ex.kind === 'info') return 0
  return e.sets ?? 0
}

/** Done sets of exercise `index` in the session. */
export function doneSets(session: SessionLog | undefined, index: number): number {
  return setsDone(session?.exercises[String(index)])
}

/** An exercise is complete when its done sets reach the planned ones (info: always). */
export function isComplete(e: EffectiveExercise, session: SessionLog | undefined): boolean {
  if (e.ex.kind === 'info') return true
  return doneSets(session, e.index) >= plannedSets(e)
}

export interface SessionProgress {
  done: number
  planned: number
}

/** "Serie fatte X / Y": over visible, non-info exercises (extra sets count as done). */
export function sessionProgress(list: readonly EffectiveExercise[], session: SessionLog | undefined): SessionProgress {
  let done = 0
  let planned = 0
  for (const e of list) {
    if (e.hidden || e.ex.kind === 'info') continue
    planned += plannedSets(e)
    done += doneSets(session, e.index)
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
