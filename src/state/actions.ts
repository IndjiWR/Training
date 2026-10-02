import type { Day, Exercise, Plan } from '../plan/schema'
import { nextStamp, same } from '../lib/dataSync'
import { applyElbow, CHECK_KEY, plannedSetCount, sessionElbowLevel } from '../lib/elbow'
import { nowISO } from '../lib/date'
import { defaultData, defaultSync, setState } from './store'
import type {
  AppData,
  DataSync,
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
  SyncKind,
} from './types'
import { SYNC_KINDS } from './types'

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

/**
 * Planned sets of every exercise of the day for the session's current elbow level
 * (plannedSetCount: hidden/info 0, `sets: null` 1 = the row the card shows).
 */
function plannedSets(plan: Plan, day: Day, session: SessionLog): Map<number, number> {
  const level = sessionElbowLevel(session, plan.elbow)
  const map = new Map<number, number>()
  for (const e of applyElbow(day, plan.library, level)) {
    map.set(e.index, plannedSetCount(e))
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

/** Re-syncs setsPlanned of existing exercise logs after an elbow/plan change (orphans untouched). */
function withPlanned(plan: Plan, day: Day, session: SessionLog): SessionLog {
  const planned = plannedSets(plan, day, session)
  let changed = false
  const exercises: Record<string, ExerciseLog> = {}
  for (const [id, log] of Object.entries(session.exercises)) {
    const p = id === String(log.index) ? planned.get(log.index) : undefined
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

/* Every user change stamps the record's `updatedAt` and marks its key as pending for the next
   upload (a pending key whose record is gone is a deletion). The first change of a synced record
   keeps the version it replaces as `base`: Drive and this device are merged against it. */

let lastMark = 0

/** Change marks: increasing, so a change made during an upload is never mistaken for the uploaded one. */
function newMark(): number {
  lastMark = Math.max(Date.now(), lastMark + 1)
  return lastMark
}

function touched(sync: DataSync, kind: SyncKind, key: string, previous: unknown): DataSync {
  const first = !Object.hasOwn(sync.pending[kind], key)
  return {
    ...sync,
    pending: { ...sync.pending, [kind]: { ...sync.pending[kind], [key]: newMark() } },
    base: first ? { ...sync.base, [kind]: { ...sync.base[kind], [key]: previous ?? null } } : sync.base,
  }
}

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
    return {
      ...state,
      sessions: { ...state.sessions, [date]: { ...next, updatedAt: nextStamp(existing) } },
      sync: touched(state.sync, 'sessions', date, existing),
    }
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

/** Started (the first start is kept). A real start also clears a "saltata" mark: the day is being trained. */
function startedNow(s: SessionLog): SessionLog {
  return s.startedAt && !s.skipped ? s : { ...s, startedAt: s.startedAt ?? nowISO(), skipped: false }
}

/* ───────────────────────── session ───────────────────────── */

/** Marks the session as started (idempotent; un-skips a day marked as skipped). */
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

/**
 * Manual override of the traffic light (null = back to automatic). Without a score, a colour
 * settles the check-gomito set (done, no value) and "Automatico" re-opens it.
 */
export function setElbowOverride(date: string, level: ElbowLevel | null): void {
  mutateSession(date, (s, { plan, day }) => {
    let next: SessionLog = { ...s, elbowOverride: level }
    const checkIndex = day.exercises.findIndex((e) => e.key === CHECK_KEY)
    const id = String(checkIndex)
    if (checkIndex >= 0 && s.elbowPre == null && (level != null || next.exercises[id])) {
      const log = next.exercises[id] ?? newExerciseLog(plan, day, checkIndex, 1)
      const sets = padSets(log.sets, 1)
      sets[0] = stampDone({ ...sets[0], done: level != null, value: null })
      next = { ...next, exercises: { ...next.exercises, [id]: { ...log, sets } } }
    }
    return withPlanned(plan, day, next)
  })
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
    const previous = state.sessions[date]
    const sessions = { ...state.sessions }
    delete sessions[date]
    return { ...state, sessions, sync: touched(state.sync, 'sessions', date, previous) }
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

export function updateDayLog(date: string, patch: Partial<Omit<DayLog, 'date' | 'updatedAt'>>): void {
  setState((state) => {
    const existing = state.days[date]
    const prev: DayLog = existing ?? { date, weightKg: null, elbowNextMorning: null, sleepH: null }
    return {
      ...state,
      days: { ...state.days, [date]: { ...prev, ...patch, date, updatedAt: nextStamp(existing) } },
      sync: touched(state.sync, 'days', date, existing),
    }
  })
}

/* ───────────────────────── media pins ───────────────────────── */

export function setPin(key: string, url: string | null): void {
  setState((state) => {
    const existing = Object.hasOwn(state.pins, key) ? state.pins[key] : undefined
    if (url && url.trim()) {
      const pin: MediaPin = { url: url.trim(), addedAt: nowISO(), updatedAt: nextStamp(existing) }
      // Computed key in a literal always defines an own property (safe even for "__proto__").
      return { ...state, pins: { ...state.pins, [key]: pin }, sync: touched(state.sync, 'pins', key, existing) }
    }
    if (!existing) return state
    const pins = { ...state.pins }
    delete pins[key]
    return { ...state, pins, sync: touched(state.sync, 'pins', key, existing) }
  })
}

/* ───────────────────────── plan replacement ───────────────────────── */

/** Id prefix of exercise logs that match no exercise of their plan day (kept for history). */
export const ORPHAN_PREFIX = 'orphan:'

function sameExercise(log: ExerciseLog, ex: Exercise | undefined): boolean {
  return ex != null && log.key === ex.key && log.kind === ex.kind
}

/** Weight of one match over any total index displacement (indexes are small). */
const MATCH = 1_000_000

/**
 * Re-aligns the logs of `session` onto `day` after a plan replacement, so that
 * session.exercises[String(i)] belongs to day.exercises[i] again (every index-based reader and
 * writer relies on it). Logs match exercises by key+kind: first in order (most matches, then the
 * least index displacement), then any leftover to the nearest free exercise with the same key+kind
 * (reordered plan). A log matching nothing is kept under "orphan:<id>": no card reads it, history
 * (latestResult, summary) still does. Returns `session` itself when nothing moves.
 */
export function remapSession(session: SessionLog, day: Day): SessionLog {
  const logs = Object.entries(session.exercises)
    .filter(([, log]) => log != null)
    .sort(([, a], [, b]) => a.index - b.index)
  const exs = day.exercises
  const n = logs.length
  const m = exs.length

  // best[a][b]: best ordered alignment of logs[a..] with exs[b..] (matches x MATCH - displacement).
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const matchScore = (a: number, b: number): number =>
    sameExercise(logs[a][1], exs[b])
      ? best[a + 1][b + 1] + MATCH - Math.abs(logs[a][1].index - b)
      : Number.NEGATIVE_INFINITY
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) best[a][b] = Math.max(best[a + 1][b], best[a][b + 1], matchScore(a, b))
  }
  const target = new Array<number>(n).fill(-1)
  const used = new Set<number>()
  for (let a = 0, b = 0; a < n && b < m; ) {
    if (best[a][b] === matchScore(a, b)) {
      target[a] = b
      used.add(b)
      a++
      b++
    } else if (best[a][b] === best[a + 1][b]) a++
    else b++
  }
  // Leftovers (exercises swapped by the new plan): nearest free exercise with the same key+kind.
  for (let a = 0; a < n; a++) {
    if (target[a] >= 0) continue
    const log = logs[a][1]
    let j = -1
    exs.forEach((ex, i) => {
      if (used.has(i) || !sameExercise(log, ex)) return
      if (j < 0 || Math.abs(i - log.index) < Math.abs(j - log.index)) j = i
    })
    if (j >= 0) {
      target[a] = j
      used.add(j)
    }
  }

  const exercises: Record<string, ExerciseLog> = {}
  const taken = new Set(logs.map(([id]) => id).filter((id) => id.startsWith(ORPHAN_PREFIX)))
  let changed = false
  logs.forEach(([id, log], a) => {
    const j = target[a]
    if (j >= 0) {
      exercises[String(j)] = j === log.index ? log : { ...log, index: j }
      if (id !== String(j) || j !== log.index) changed = true
    } else if (id.startsWith(ORPHAN_PREFIX)) {
      exercises[id] = log
    } else {
      const base = `${ORPHAN_PREFIX}${id}`
      let orphanId = base
      for (let k = 2; taken.has(orphanId); k++) orphanId = `${base}~${k}`
      taken.add(orphanId)
      exercises[orphanId] = log
      changed = true
    }
  })
  return changed ? { ...session, exercises } : session
}

/**
 * Re-aligns the sessions on the dates `plan` covers (remapSession) and re-syncs their setsPlanned.
 * Not a user change: `updatedAt` is left alone (also used on sessions downloaded from Drive).
 */
export function alignSessions(plan: Plan, sessions: Record<string, SessionLog>): Record<string, SessionLog> {
  let out = sessions
  const seen = new Set<string>()
  for (const day of plan.days) {
    // findDay() semantics: the first day of a date wins.
    if (seen.has(day.date)) continue
    seen.add(day.date)
    const s = Object.hasOwn(sessions, day.date) ? sessions[day.date] : undefined
    if (!s?.exercises) continue
    const next = withPlanned(plan, day, remapSession(s, day))
    if (next !== s) out = { ...out, [day.date]: next }
  }
  return out
}

/* ───────────────────────── settings & plan ───────────────────────── */

export function updateSettings(patch: Partial<Settings>): void {
  setState((state) => {
    const settings = { ...state.settings, ...patch }
    // Another link: replies of the previous one are ignored. Nothing else changes: a new deployment
    // of the same script reaches the same Drive file, and another file answers with another
    // identity (the data is then merged with it).
    const relinked = settings.endpoint.trim() !== state.settings.endpoint.trim()
    return {
      ...state,
      settings,
      sync: relinked ? { ...state.sync, generation: state.sync.generation + 1 } : state.sync,
    }
  })
}

/** Stores a validated plan as the current one; logs on the dates it covers follow their exercises. */
export function setPlan(plan: Plan, source: PlanSource): void {
  setState((state) => ({
    ...state,
    plan,
    sessions: alignSessions(plan, state.sessions),
    planMeta: { ...state.planMeta, source, receivedAt: nowISO(), lastError: null },
  }))
}

export function setPlanMeta(patch: Partial<PlanMeta>): void {
  setState((state) => ({ ...state, planMeta: { ...state.planMeta, ...patch } }))
}

/* ───────────────────────── whole data ───────────────────────── */

/**
 * Replaces everything (backup import). Logs are re-aligned onto the imported plan. Every record
 * that differs (deletions included) becomes a local change, like any edit: with saving on Drive
 * the backup replaces the data on Drive too (on a device never synced, it is merged with Drive at
 * the first sync). A sync reply already on its way is ignored (new generation).
 */
export function replaceAllData(data: AppData): void {
  setState((state) => {
    const sessions = data.plan ? alignSessions(data.plan, data.sessions) : data.sessions
    const next: AppData = { ...data, sessions, sync: state.sync }

    let sync: DataSync = { ...state.sync, generation: state.sync.generation + 1 }
    const changed = { sessions: { ...next.sessions }, days: { ...next.days }, pins: { ...next.pins } } as Record<
      SyncKind,
      Record<string, { updatedAt?: number }>
    >
    for (const kind of SYNC_KINDS) {
      const before = state[kind] as Record<string, { updatedAt?: number }>
      const after = changed[kind]
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const old = Object.hasOwn(before, key) ? before[key] : undefined
        const imported = Object.hasOwn(after, key) ? after[key] : undefined
        if (same(old, imported)) continue
        if (imported) after[key] = { ...imported, updatedAt: nextStamp(old) }
        sync = touched(sync, kind, key, old)
      }
    }
    return {
      ...next,
      sessions: changed.sessions as AppData['sessions'],
      days: changed.days as AppData['days'],
      pins: changed.pins as AppData['pins'],
      sync,
    }
  })
}

/**
 * Wipes logs, plan and pins on this device. Keeps endpoint/token/preferences when keepSettings.
 * The copy on Drive is not touched: with sync on, the next sync downloads it again.
 */
export function clearAllData(keepSettings = true): void {
  setState((state) => {
    const fresh = defaultData()
    const sync = defaultSync(state.sync.enabled, state.sync.generation + 1)
    return keepSettings ? { ...fresh, settings: state.settings, sync } : { ...fresh, sync }
  })
}

/**
 * Deletes every log (sessions, diary, pinned media) as user changes: with saving on Drive the
 * deletions go to Drive and to the other devices. Plan, settings and link stay.
 */
export function deleteAllLogs(): void {
  setState((state) => {
    let sync = state.sync
    for (const kind of SYNC_KINDS) {
      for (const [key, rec] of Object.entries(state[kind])) sync = touched(sync, kind, key, rec)
    }
    return sync === state.sync ? state : { ...state, sessions: {}, days: {}, pins: {}, sync }
  })
}

/** Turns the saving on Google Drive on or off for this device. */
export function setSyncEnabled(enabled: boolean): void {
  setState((state) => (state.sync.enabled === enabled ? state : { ...state, sync: { ...state.sync, enabled } }))
}
