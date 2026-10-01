import type { Day, DayType, Exercise, LibraryEntry, Plan } from '../plan/schema'
import type { DayLog, ElbowLevel, ExerciseLog, SessionLog } from '../state/types'
import { formatShortDate } from './date'
import {
  applyElbow,
  CHECK_KEY,
  elbowLevel,
  isOptional,
  levelEmoji,
  levelLabel,
  libraryEntry,
  plannedSetCount,
  sessionElbowLevel,
} from './elbow'
import { formatNumberIt, formatValue } from './format'
import { bestResult, recordedValues, setsDone } from './results'

export type SessionStatus = 'done' | 'partial' | 'skipped' | 'planned' | 'rest'

export interface SessionSummary {
  date: string
  weekday: string | null
  type: DayType
  title: string | null
  status: SessionStatus
  /** Done sets of the exercises counted in setsPlanned (extra sets included). */
  setsDone: number
  setsPlanned: number
  /** Done sets of optional exercises (block "Opzionale"): outside setsDone/setsPlanned. */
  setsOptionalDone: number
  /** Done sets of exercises hidden by the session's elbow level (logged before a re-score). */
  setsHiddenDone: number
  rpe: number | null
  elbowPre: number | null
  elbowDuring: number | null
  /** Effective elbow level of the session (override or from elbowPre), null if none. */
  elbowLevel: ElbowLevel | null
}

export interface TestResultSummary {
  date: string
  key: string
  /** Exercise name as written in the plan day. */
  name: string
  /**
   * Short name for the chat text: `name` up to the first ":" (check-gomito: the library label),
   * with " · <short date>" appended when two tests of the week would read the same.
   */
  label: string
  unit: string | null
  /** Best value (per_side: null, see dx/sx). For check-gomito: the elbow score. */
  value: number | null
  dx: number | null
  sx: number | null
  /** All values of done attempts/sets in order (for "migliore di 3" context). */
  values: number[]
  text: string | null
  /** False when the test exercise has no recorded result yet. */
  recorded: boolean
}

export interface WeekSummary {
  planId: string
  planTitle: string | null
  period: string | null
  start: string
  end: string
  sessions: SessionSummary[]
  counts: { done: number; partial: number; skipped: number; planned: number }
  tests: TestResultSummary[]
  /** Max of every elbow score of the week (elbowPre, elbowDuring, elbowNextMorning). */
  elbowMax: number | null
  elbowMaxLevel: ElbowLevel | null
  weightAvg: number | null
  weightCount: number
  sleepAvg: number | null
  sleepCount: number
  notes: { date: string; text: string }[]
}

export interface WeekSummaryInput {
  plan: Plan
  sessions: Record<string, SessionLog>
  days: Record<string, DayLog>
  /** Today YYYY-MM-DD (Europe/Rome). */
  today: string
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/** Values of a by-date record (record key as fallback date), skipping holes. */
function dated<T extends { date: string }>(record: Record<string, T>): T[] {
  const out: T[] = []
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object') out.push(value.date ? value : { ...value, date: key })
  }
  return out
}

/** Plan days by date (stable for equal dates). */
function sortedDays(plan: Plan): Day[] {
  return plan.days
    .map((day, i) => ({ day, i }))
    .sort((a, b) => byDate(a.day, b.day) || a.i - b.i)
    .map((x) => x.day)
}

/**
 * Log of exercise `index` of a session. Falls back to a log with the same key and kind when the
 * plan was replaced and indexes shifted (logs keep a copy of their key).
 */
function findLog(session: SessionLog | undefined, index: number, ex: Exercise): ExerciseLog | undefined {
  if (!session?.exercises) return undefined
  const direct = session.exercises[String(index)]
  if (direct && direct.key === ex.key) return direct
  return Object.values(session.exercises).find((l) => l && l.key === ex.key && l.kind === ex.kind)
}

interface SetCounts {
  planned: number
  done: number
  optionalDone: number
  hiddenDone: number
}

/**
 * Planned and done sets of a training day at the session's elbow level, with the same rule as
 * Oggi's "Serie X/Y": only exercises that are visible and not 'info' count (plannedSetCount), so
 * sets done on an exercise hidden by a later elbow change go to `hiddenDone` instead. Optional
 * exercises (block "Opzionale") count in neither: their done sets go to `optionalDone`. Extra sets
 * on a counted exercise count too (not capped). The elbow check counts as done once the session
 * has a score or a manual traffic light (the gate is settled), even without its set log.
 */
function setCounts(plan: Plan, day: Day, session: SessionLog | undefined, level: ElbowLevel | null): SetCounts {
  const out: SetCounts = { planned: 0, done: 0, optionalDone: 0, hiddenDone: 0 }
  const used = new Set<ExerciseLog>()
  for (const e of applyElbow(day, plan.library, level)) {
    if (e.ex.kind === 'info') continue
    const log = findLog(session, e.index, e.ex)
    // findLog's key fallback must not count one log twice.
    let done = log && !used.has(log) ? setsDone(log) : 0
    if (log) used.add(log)
    if (e.hidden) {
      out.hiddenDone += done
      continue
    }
    if (e.ex.key === CHECK_KEY && (session?.elbowPre != null || session?.elbowOverride != null)) done = Math.max(done, 1)
    if (isOptional(e.ex)) {
      out.optionalDone += done
    } else {
      out.planned += plannedSetCount(e)
      out.done += done
    }
  }
  return out
}

function statusOf(day: Day, session: SessionLog | undefined, counts: SetCounts, today: string): SessionStatus {
  if (day.type === 'RIPOSO') return 'rest'
  const worked = counts.done + counts.optionalDone + counts.hiddenDone > 0
  // A skipped mark left on a session that was trained afterwards does not hide the work.
  if (session?.skipped && !worked) return 'skipped'
  if (worked) return counts.done >= counts.planned ? 'done' : 'partial'
  return day.date < today ? 'skipped' : 'planned'
}

/** Chat label of a test: the plan name up to the first ":" (check-gomito: the library label). */
function testLabel(ex: Exercise, lib: LibraryEntry | null): string {
  const label = lib?.label.trim() ?? ''
  const name = ex.name.trim()
  if (ex.key === CHECK_KEY) return label || name
  return name.split(':')[0].trim() || label || name
}

/** Appends " · <short date>" to the labels that more than one test of the week would share. */
function disambiguate(tests: TestResultSummary[]): TestResultSummary[] {
  const seen = new Map<string, number>()
  for (const t of tests) seen.set(t.label, (seen.get(t.label) ?? 0) + 1)
  return tests.map((t) => ((seen.get(t.label) ?? 0) > 1 ? { ...t, label: `${t.label} · ${formatShortDate(t.date)}` } : t))
}

function testResult(plan: Plan, day: Day, session: SessionLog | undefined, ex: Exercise, index: number): TestResultSummary {
  const log = findLog(session, index, ex)
  const lib = libraryEntry(plan.library, ex.key)
  const base = { date: day.date, key: ex.key, name: ex.name, label: testLabel(ex, lib) }
  const text = log?.text?.trim() || null

  if (ex.key === CHECK_KEY) {
    const pre = session?.elbowPre
    const value = isNum(pre) ? pre : bestResult(log).best
    return {
      ...base,
      unit: '0-10',
      value,
      dx: null,
      sx: null,
      values: value != null ? [value] : [],
      text,
      recorded: value != null || text != null,
    }
  }

  // The log's own copy wins: results stay readable after the plan has been replaced.
  const unit = log ? (log.measure ?? log.unit) : (lib?.measure ?? ex.unit)
  const best = bestResult(log)
  const perSide = log?.perSide ?? ex.per_side
  const value = perSide ? null : best.best
  const dx = perSide ? best.dx : null
  const sx = perSide ? best.sx : null
  return {
    ...base,
    unit,
    value,
    dx,
    sx,
    values: log ? recordedValues(log) : [],
    text,
    recorded: value != null || dx != null || sx != null || text != null,
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Builds the week summary for the current plan.
 * Week range: plan.start..plan.end (fallback: min..max of days[].date).
 * Per training day (type !== 'RIPOSO'), with the session's elbow level (applyElbow):
 *   setsPlanned = plannedSetCount over the exercises that are not optional (block "Opzionale"):
 *                 visible, not kind 'info', sets null -> 1;
 *   setsDone    = done sets of those same exercises (same as Oggi's "Serie X/Y"; extra sets
 *                 count, not capped). The elbow check counts as done once the session has a score
 *                 or a manual traffic light;
 *   setsOptionalDone / setsHiddenDone = done sets of optional exercises / of exercises hidden by
 *                 the level (logged before a re-score): reported, never compared with setsPlanned;
 *   status: work = setsDone + setsOptionalDone + setsHiddenDone > 0.
 *           session.skipped and no work -> 'skipped'; work and setsDone >= setsPlanned -> 'done';
 *           other work -> 'partial'; no work and date < today -> 'skipped'; else 'planned'.
 *           (Work on a day with 0 planned sets -> 'done'.)
 * RIPOSO days -> status 'rest' (setsPlanned 0), not counted in `counts`.
 * Tests: every exercise with test=true in training days, in plan order; check-gomito uses
 *   session.elbowPre as value. Labels: see TestResultSummary.label.
 * Elbow max: max over sessions' elbowPre/elbowDuring and days' elbowNextMorning in range.
 * Weight/sleep averages over DayLog entries in range (null when none).
 * Notes: non-empty session notes in date order.
 */
export function computeWeekSummary(input: WeekSummaryInput): WeekSummary {
  const { plan, sessions, days, today } = input
  const ordered = sortedDays(plan)
  const start = plan.start ?? ordered[0]?.date ?? today
  const end = plan.end ?? ordered[ordered.length - 1]?.date ?? today
  const inRange = (date: string) => date >= start && date <= end

  const summaries: SessionSummary[] = []
  const tests: TestResultSummary[] = []
  const counts = { done: 0, partial: 0, skipped: 0, planned: 0 }

  for (const day of ordered) {
    const session = sessions[day.date]
    const level = sessionElbowLevel(session, plan.elbow)
    const rest = day.type === 'RIPOSO'
    const sets: SetCounts = rest
      ? { planned: 0, done: 0, optionalDone: 0, hiddenDone: 0 }
      : setCounts(plan, day, session, level)
    const status = statusOf(day, session, sets, today)
    if (status !== 'rest') counts[status]++

    summaries.push({
      date: day.date,
      weekday: day.weekday,
      type: day.type,
      title: day.title,
      status,
      setsDone: sets.done,
      setsPlanned: sets.planned,
      setsOptionalDone: sets.optionalDone,
      setsHiddenDone: sets.hiddenDone,
      rpe: session?.rpe ?? null,
      elbowPre: session?.elbowPre ?? null,
      elbowDuring: session?.elbowDuring ?? null,
      elbowLevel: level,
    })

    if (rest) continue
    day.exercises.forEach((ex, index) => {
      if (ex.test) tests.push(testResult(plan, day, session, ex, index))
    })
  }

  const weekSessions = dated(sessions)
    .filter((s) => inRange(s.date))
    .sort(byDate)
  const weekDays = dated(days).filter((d) => inRange(d.date))

  const elbowScores = [
    ...weekSessions.flatMap((s) => [s.elbowPre, s.elbowDuring]),
    ...weekDays.map((d) => d.elbowNextMorning),
  ].filter(isNum)
  const elbowMax = elbowScores.length ? Math.max(...elbowScores) : null

  const weights = weekDays.map((d) => d.weightKg).filter(isNum)
  const sleeps = weekDays.map((d) => d.sleepH).filter(isNum)

  const notes = weekSessions
    .map((s) => ({ date: s.date, text: typeof s.notes === 'string' ? s.notes.trim() : '' }))
    .filter((n) => n.text !== '')

  return {
    planId: plan.id,
    planTitle: plan.title,
    period: plan.period,
    start,
    end,
    sessions: summaries,
    counts,
    tests: disambiguate(tests),
    elbowMax,
    elbowMaxLevel: elbowMax != null ? elbowLevel(elbowMax, plan.elbow) : null,
    weightAvg: average(weights),
    weightCount: weights.length,
    sleepAvg: average(sleeps),
    sleepCount: sleeps.length,
    notes,
  }
}

/* ───────────────────────── text ───────────────────────── */

const ND = 'n.d.'

const STATUS_TEXT: Record<SessionStatus, string> = {
  done: 'fatta',
  partial: 'parziale',
  skipped: 'saltata',
  planned: 'da fare',
  rest: 'riposo',
}

/** "1 fatta" / "2 fatte". */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Average with exactly one decimal and the Italian comma: 73 -> "73,0". */
const oneDecimal = (n: number) => n.toFixed(1).replace('.', ',')

const score = (n: number) => `${formatNumberIt(n)}/10`

const withUnit = (n: number | null, unit: string | null) => (n == null ? ND : formatValue(n, unit))

/** Notes on one line (chat friendly). */
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' / ').replace(/[ \t]+/g, ' ')

function sessionLine(s: SessionSummary): string {
  const head = `• ${formatShortDate(s.date)}`
  if (s.status === 'rest') return `${head} · ${STATUS_TEXT.rest}`
  let sets = `serie ${s.setsDone}/${s.setsPlanned}`
  if (s.setsOptionalDone) sets += ` + ${plural(s.setsOptionalDone, 'opzionale', 'opzionali')}`
  if (s.setsHiddenDone) sets += ` + ${plural(s.setsHiddenDone, 'nascosta', 'nascoste')} per il gomito`
  const parts = [STATUS_TEXT[s.status], sets]
  if (s.rpe != null) parts.push(`RPE ${formatNumberIt(s.rpe)}`)
  const elbow: string[] = []
  if (s.elbowLevel) {
    const pre = s.elbowPre != null ? `${score(s.elbowPre)} ` : ''
    elbow.push(`${pre}${levelEmoji(s.elbowLevel)} ${levelLabel(s.elbowLevel)}`)
  } else if (s.elbowPre != null) {
    elbow.push(score(s.elbowPre))
  }
  if (s.elbowDuring != null) elbow.push(`durante ${score(s.elbowDuring)}`)
  if (elbow.length) parts.push(`gomito ${elbow.join(', ')}`)
  return `${head} · ${s.type} — ${parts.join(' · ')}`
}

function testLine(t: TestResultSummary): string {
  const head = `• ${t.label} — `
  if (!t.recorded) return `${head}${ND}`
  const parts: string[] = []
  if (t.text) parts.push(t.text)
  if (t.dx != null || t.sx != null) {
    parts.push(`dx ${withUnit(t.dx, t.unit)} · sx ${withUnit(t.sx, t.unit)}`)
  } else if (t.value != null) {
    const all =
      t.values.length > 1 ? ` (migliore di ${t.values.length}: ${t.values.map((v) => formatNumberIt(v)).join(' / ')})` : ''
    parts.push(`${withUnit(t.value, t.unit)}${all}`)
  }
  return `${head}${parts.join(' · ')}`
}

/**
 * Italian plain text for the Sunday check-in (copy/paste into chat). Must contain:
 * title + period; sessions with status in Italian ("fatta", "parziale", "saltata",
 * "da fare", "riposo") and "serie X/Y"; test results with units; elbow max "N/10" with
 * traffic light emoji and label; average weight "kg" and sleep "h" with Italian decimal comma
 * (1 decimal) and the number of entries; notes. Missing data -> explicit "n.d." / "nessuna".
 * Layout: title line, period line, then the sections SESSIONI / TEST / GOMITO / PESO E SONNO /
 * NOTE with "• " bullet lines, separated by blank lines.
 */
export function formatWeekSummary(summary: WeekSummary): string {
  const s = summary
  const out: string[] = []

  out.push(s.planTitle ? `Riepilogo settimana — ${s.planTitle}` : 'Riepilogo settimana')
  out.push(s.period ?? `${formatShortDate(s.start)} – ${formatShortDate(s.end)}`)

  const c = s.counts
  const tally = [
    c.done ? plural(c.done, 'fatta', 'fatte') : '',
    c.partial ? plural(c.partial, 'parziale', 'parziali') : '',
    c.skipped ? plural(c.skipped, 'saltata', 'saltate') : '',
    c.planned ? `${c.planned} da fare` : '',
  ].filter(Boolean)
  out.push('', tally.length ? `SESSIONI (${tally.join(' · ')})` : 'SESSIONI')
  if (s.sessions.length) out.push(...s.sessions.map(sessionLine))
  else out.push('• nessuna')

  out.push('', 'TEST')
  if (s.tests.length) out.push(...s.tests.map(testLine))
  else out.push('• nessun test in scheda')

  out.push('', 'GOMITO')
  out.push(
    s.elbowMax != null && s.elbowMaxLevel
      ? `• Voto massimo: ${score(s.elbowMax)} ${levelEmoji(s.elbowMaxLevel)} ${levelLabel(s.elbowMaxLevel)}`
      : `• Voto massimo: ${ND}`,
  )

  out.push('', 'PESO E SONNO')
  out.push(
    s.weightAvg != null
      ? `• Peso medio: ${oneDecimal(s.weightAvg)} kg (${plural(s.weightCount, 'rilevazione', 'rilevazioni')})`
      : `• Peso medio: ${ND}`,
  )
  out.push(
    s.sleepAvg != null
      ? `• Sonno medio: ${oneDecimal(s.sleepAvg)} h (${plural(s.sleepCount, 'notte', 'notti')})`
      : `• Sonno medio: ${ND}`,
  )

  out.push('', 'NOTE')
  if (s.notes.length) out.push(...s.notes.map((n) => `• ${formatShortDate(n.date)}: ${oneLine(n.text)}`))
  else out.push('• nessuna')

  return out.join('\n')
}
