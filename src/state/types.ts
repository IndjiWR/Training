import type { DayType, Kind, Plan, Unit } from '../plan/schema'

export type ElbowLevel = 'green' | 'yellow' | 'red'

/** One side (dx/sx) of a per_side set. */
export interface SideLog {
  done: boolean
  value: number | null
}

/**
 * One set / attempt / timed block.
 * - reps: value = reps done
 * - hold / attempts(s) / max(s): value = seconds held
 * - time: value = seconds actually done (countdown elapsed)
 * - distance: value = metres (target), done = checked
 * - attempts/max with cm, rep, 0-10: value = number entered
 * - per_side exercises use dx/sx; `done` = both sides done, `value` stays null.
 */
export interface SetLog {
  done: boolean
  value: number | null
  dx?: SideLog
  sx?: SideLog
  /** ISO timestamp of completion. */
  at?: string | null
}

/**
 * Log of one exercise of a session. It copies the exercise metadata it needs so that
 * history (results, %max, summaries) works even after the plan has been replaced.
 */
export interface ExerciseLog {
  /** Position of the exercise in day.exercises (0-based). */
  index: number
  key: string
  name: string
  kind: Kind
  unit: Unit | null
  /** library[key].measure at the time of the session ("0-10" = pain score). */
  measure: string | null
  test: boolean
  perSide: boolean
  /** Sets planned for this session after the elbow transform (0 if hidden). */
  setsPlanned: number
  sets: SetLog[]
  /** Free-text result (e.g. front lever progression "adv tuck"). */
  text?: string
}

export interface SessionLog {
  /** YYYY-MM-DD, also the key in AppData.sessions. */
  date: string
  planId: string
  dayType: DayType
  dayTitle: string | null
  startedAt: string | null
  finishedAt: string | null
  /** Elbow score 0-10 from the pre-session check (check-gomito). */
  elbowPre: number | null
  /** Manual override of the elbow traffic light; null = automatic from elbowPre. */
  elbowOverride: ElbowLevel | null
  /** Session RPE 1-10. */
  rpe: number | null
  /** Elbow pain during the session 0-10. */
  elbowDuring: number | null
  notes: string
  /** Explicitly marked as skipped by the user. */
  skipped: boolean
  /** Keyed by String(exercise index). */
  exercises: Record<string, ExerciseLog>
}

/** Per-calendar-day log, rest days included. */
export interface DayLog {
  date: string
  /** Morning weight in kg. */
  weightKg: number | null
  /** Elbow pain the morning after this day's session, 0-10. */
  elbowNextMorning: number | null
  /** Hours of sleep (the night before this day). */
  sleepH: number | null
}

/** A media pinned to a library key: YouTube URL or image/GIF URL. */
export interface MediaPin {
  url: string
  addedAt: string
}

export type ThemeName = 'dark' | 'light'

export interface Settings {
  /** Apps Script /exec URL. Stored only on this device. */
  endpoint: string
  /** Shared secret sent as ?token=. Stored only on this device, never exported. */
  token: string
  theme: ThemeName
  sound: boolean
  vibration: boolean
}

export type PlanSource = 'remote' | 'file' | 'example'

export interface PlanMeta {
  source: PlanSource | null
  /** When the cached plan was received/imported. */
  receivedAt: string | null
  /** Last successful contact with the endpoint. */
  lastCheckAt: string | null
  /** Last sync error (shown in Impostazioni), cleared on success. */
  lastError: string | null
}

export interface AppData {
  version: 1
  settings: Settings
  plan: Plan | null
  planMeta: PlanMeta
  /** Keyed by date YYYY-MM-DD. */
  sessions: Record<string, SessionLog>
  /** Keyed by date YYYY-MM-DD. */
  days: Record<string, DayLog>
  /** Keyed by library key. */
  pins: Record<string, MediaPin>
}
