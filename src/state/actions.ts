import type { Day, Plan } from '../plan/schema'
import { applyElbow, CHECK_KEY, sessionElbowLevel } from '../lib/elbow'
import { nowISO } from '../lib/date'
import { defaultData, setState } from './store'
import type {
  AppData,
  DayLog,
  ElbowLevel,
  ExerciseLog,
  MediaPin,
  PlanMeta,
  PlanSource,
  SessionLog,
  SetLog,
  Settings,
  SideLog,
} from './types'

/* ───────────────────────── helpers ───────────────────────── */

function findDay(plan: Plan, date: string): Day | undefined {
  return plan.days.find((d) => d.date === date)
}

function newSession(plan: Plan, day: Day): SessionLog {
  return {
    date: day.date,
    planId: plan.id,
    dayType: day.type,
    dayTitle: day.title,
    startedAt: null,
    finishedAt: null,
    elbowPre: null,
    elbowOverride: null,
    rpe: null,
    elbowDuring: null,
    notes: '',
    skipped: false,
    exercises: {},
  }
}

/** Planned sets of every exercise of the day for the session's current elbow level. */
function plannedSets(plan: Plan, day: Day, session: SessionLog): Map<number, number> {
  const level = sessionElbowLevel(session, plan.elbow)
  const map = new Map<number, number>()
  for (const e of applyElbow(day, plan.library, level)) {
    map.set(e.index, e.hidden || e.ex.kind === 'info' ? 0 : (e.sets ?? 0))
  }
  return map
}

function newExerciseLog(plan: Plan, day: Day, index: number, setsPlanned: number): ExerciseLog {
  const ex = day.exercises[index]
  const lib = plan.library[ex.key] ?? null
  return {
    index,
    key: ex.key,
    name: ex.name,
    kind: ex.kind,
    unit: ex.unit,
    measure: lib?.measure ?? null,
    test: ex.test,
    perSide: ex.per_side,
    setsPlanned,
    sets: [],
  }
}

/** Re-syncs setsPlanned of existing exercise logs after an elbow change. */
function withPlanned(plan: Plan, day: Day, session: SessionLog): SessionLog {
  const planned = plannedSets(plan, day, session)
  let changed = false
  const exercises: Record<string, ExerciseLog> = {}
  for (const [id, log] of Object.entries(session.exercises)) {
    const p = planned.get(log.index)
    if (p !== undefined && p !== log.setsPlanned) {
      exercises[id] = { ...log, setsPlanned: p }
      changed = true
    } else {
      exercises[id] = log
    }
  }
  return changed ? { ...session, exercises } : session
}

type Ctx = { plan: Plan; day: Day }

/** Applies `fn` to the session of `date` (created on demand). No-op without plan/day. */
function mutateSession(date: string, fn: (s: SessionLog, ctx: Ctx) => SessionLog): void {
  setState((state) => {
    const plan = state.plan
    if (!plan) return state
    const day = findDay(plan, date)
    if (!day) return state
    const existing = state.sessions[date]
    const current = existing ?? newSession(plan, day)
    const next = fn(current, { plan, day })
    if (existing && next === existing) return state
    return { ...state, sessions: { ...state.sessions, [date]: next } }
  })
}

/** Applies `fn` to the exercise log (created on demand) of exercise `index` of `date`. */
function mutateExercise(date: string, index: number, fn: (log: ExerciseLog) => ExerciseLog): void {
  mutateSession(date, (session, { plan, day }) => {
    if (index < 0 || index >= day.exercises.length) return session
    const id = String(index)
    const log = session.exercises[id] ?? newExerciseLog(plan, day, index, plannedSets(plan, day, session).get(index) ?? 0)
    const nextLog = fn(log)
    if (nextLog === log && session.exercises[id]) return session
    return { ...session, exercises: { ...session.exercises, [id]: nextLog } }
  })
}

const EMPTY_SET: SetLog = { done: false, value: null }
const EMPTY_SIDE: SideLog = { done: false, value: null }

/** Rows shown for an exercise log: planned sets or more if the user added some. */
export function rowCount(log: ExerciseLog | undefined, fallbackPlanned: number): number {
  if (!log) return fallbackPlanned
  return Math.max(log.setsPlanned, log.sets.length)
}

function padSets(sets: SetLog[], length: number): SetLog[] {
  if (sets.length >= length) return sets.slice()
  return [...sets, ...Array.from({ length: length - sets.length }, () => ({ ...EMPTY_SET }))]
}

function stampDone(set: SetLog): SetLog {
  return { ...set, at: set.done ? (set.at ?? nowISO()) : null }
}

function startedNow(s: SessionLog): SessionLog {
  return s.startedAt ? s : { ...s, startedAt: nowISO() }
}

/* ───────────────────────── session ───────────────────────── */

/** Marks the session as started (idempotent). */
export function startSession(date: string): void {
  mutateSession(date, (s) => startedNow(s))
}

/** Records the pre-session elbow score (also as result of the check-gomito exercise). */
export function setElbowPre(date: string, score: number): void {
  mutateSession(date, (s, { plan, day }) => {
    let next: SessionLog = startedNow({ ...s, elbowPre: score })
    const checkIndex = day.exercises.findIndex((e) => e.key === CHECK_KEY)
    if (checkIndex >= 0) {
      const id = String(checkIndex)
      const log = next.exercises[id] ?? newExerciseLog(plan, day, checkIndex, 1)
      const sets = padSets(log.sets, 1)
      sets[0] = stampDone({ ...sets[0], done: true, value: score })
      next = { ...next, exercises: { ...next.exercises, [id]: { ...log, sets } } }
    }
    return withPlanned(plan, day, next)
  })
}

/** Manual override of the traffic light (null = back to automatic). */
export function setElbowOverride(date: string, level: ElbowLevel | null): void {
  mutateSession(date, (s, { plan, day }) => withPlanned(plan, day, { ...s, elbowOverride: level }))
}

export function updateSessionMeta(
  date: string,
  patch: Partial<Pick<SessionLog, 'rpe' | 'elbowDuring' | 'notes' | 'skipped'>>,
): void {
  mutateSession(date, (s) => ({ ...s, ...patch }))
}

/** Closes the session with its final log (RPE 1-10, elbow during 0-10, notes). */
export function finishSession(
  date: string,
  log: { rpe: number | null; elbowDuring: number | null; notes: string },
): void {
  mutateSession(date, (s) => ({ ...startedNow(s), ...log, finishedAt: nowISO() }))
}

export function reopenSession(date: string): void {
  mutateSession(date, (s) => (s.finishedAt ? { ...s, finishedAt: null } : s))
}

export function markSkipped(date: string, skipped: boolean): void {
  mutateSession(date, (s) => ({ ...s, skipped }))
}

/** Deletes the whole session log of a date (sets, elbow, notes). */
export function deleteSession(date: string): void {
  setState((state) => {
    if (!state.sessions[date]) return state
    const sessions = { ...state.sessions }
    delete sessions[date]
    return { ...state, sessions }
  })
}

/* ───────────────────────── sets ───────────────────────── */

/** Merges `patch` into set `setIndex` (array padded as needed). done=true stamps `at`. */
export function updateSet(date: string, index: number, setIndex: number, patch: Partial<SetLog>): void {
  let marksDone = false
  mutateExercise(date, index, (log) => {
    const sets = padSets(log.sets, setIndex + 1)
    const merged = stampDone({ ...sets[setIndex], ...patch })
    marksDone = merged.done
    sets[setIndex] = merged
    return { ...log, sets }
  })
  if (marksDone) startSession(date)
}

/** Updates one side of a per_side set; set.done = dx.done && sx.done. */
export function updateSide(
  date: string,
  index: number,
  setIndex: number,
  side: 'dx' | 'sx',
  patch: Partial<SideLog>,
): void {
  let marksDone = false
  mutateExercise(date, index, (log) => {
    const sets = padSets(log.sets, setIndex + 1)
    const prev = sets[setIndex]
    const nextSide: SideLog = { ...(prev[side] ?? EMPTY_SIDE), ...patch }
    const merged: SetLog = { ...prev, [side]: nextSide }
    merged.done = Boolean(merged.dx?.done && merged.sx?.done)
    sets[setIndex] = stampDone(merged)
    marksDone = Boolean(nextSide.done)
    return { ...log, sets }
  })
  if (marksDone) startSession(date)
}

/** Adds one empty set/attempt after the visible rows (cap to sets_max in the UI). */
export function addSet(date: string, index: number): void {
  mutateExercise(date, index, (log) => ({ ...log, sets: padSets(log.sets, rowCount(log, log.setsPlanned) + 1) }))
}

/** Removes the last row if it is an extra (beyond planned) row that is not done. */
export function removeExtraSet(date: string, index: number): void {
  mutateExercise(date, index, (log) => {
    const rows = rowCount(log, log.setsPlanned)
    if (rows <= log.setsPlanned) return log
    const last = log.sets[rows - 1]
    if (last?.done) return log
    return { ...log, sets: log.sets.slice(0, rows - 1) }
  })
}

/** Free-text result (e.g. front lever progression). */
export function setExerciseText(date: string, index: number, text: string): void {
  mutateExercise(date, index, (log) => ({ ...log, text }))
}

/** Clears every set of an exercise. */
export function resetExercise(date: string, index: number): void {
  mutateSession(date, (s) => {
    const id = String(index)
    if (!s.exercises[id]) return s
    const exercises = { ...s.exercises }
    delete exercises[id]
    return { ...s, exercises }
  })
}

/* ───────────────────────── day log ───────────────────────── */

export function updateDayLog(date: string, patch: Partial<Omit<DayLog, 'date'>>): void {
  setState((state) => {
    const prev: DayLog = state.days[date] ?? { date, weightKg: null, elbowNextMorning: null, sleepH: null }
    return { ...state, days: { ...state.days, [date]: { ...prev, ...patch, date } } }
  })
}

/* ───────────────────────── media pins ───────────────────────── */

export function setPin(key: string, url: string | null): void {
  setState((state) => {
    if (url && url.trim()) {
      const pin: MediaPin = { url: url.trim(), addedAt: nowISO() }
      // Computed key in a literal always defines an own property (safe even for "__proto__").
      return { ...state, pins: { ...state.pins, [key]: pin } }
    }
    if (!Object.hasOwn(state.pins, key)) return state
    const pins = { ...state.pins }
    delete pins[key]
    return { ...state, pins }
  })
}

/* ───────────────────────── settings & plan ───────────────────────── */

export function updateSettings(patch: Partial<Settings>): void {
  setState((state) => ({ ...state, settings: { ...state.settings, ...patch } }))
}

/** Stores a validated plan as the current one. */
export function setPlan(plan: Plan, source: PlanSource): void {
  setState((state) => ({
    ...state,
    plan,
    planMeta: { ...state.planMeta, source, receivedAt: nowISO(), lastError: null },
  }))
}

export function setPlanMeta(patch: Partial<PlanMeta>): void {
  setState((state) => ({ ...state, planMeta: { ...state.planMeta, ...patch } }))
}

/* ───────────────────────── whole data ───────────────────────── */

/** Replaces everything (backup import). */
export function replaceAllData(data: AppData): void {
  setState(() => data)
}

/** Wipes logs, plan and pins. Keeps endpoint/token/preferences when keepSettings. */
export function clearAllData(keepSettings = true): void {
  setState((state) => {
    const fresh = defaultData()
    return keepSettings ? { ...fresh, settings: state.settings } : fresh
  })
}
