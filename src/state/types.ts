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
  /** Last change (epoch ms): the newest copy wins when syncing with Drive. Missing = before sync existed. */
  updatedAt?: number
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
  /** Last change (epoch ms), see SessionLog.updatedAt. */
  updatedAt?: number
}

/** A media pinned to a library key: YouTube URL or image/GIF URL. */
export interface MediaPin {
  url: string
  addedAt: string
  /** Last change (epoch ms), see SessionLog.updatedAt. */
  updatedAt?: number
}

/** The records saved on Google Drive (the plan already lives there, settings stay per device). */
export const SYNC_KINDS = ['sessions', 'days', 'pins'] as const
export type SyncKind = (typeof SYNC_KINDS)[number]

/**
 * Saving of the logs on Google Drive (file training-dati.json, through the Apps Script).
 * Drive accepts a change only when the device had seen the latest version of that record;
 * otherwise the device merges both versions (3-way, against `base`) and sends the result: nothing
 * is overwritten blindly.
 */
export interface DataSync {
  /** On by default once the device is linked to Drive. */
  enabled: boolean
  /** Identity of the Drive file this device is synced with (null: not yet, or it must start over). */
  epoch: string | null
  /** Revision of the Drive file at the last sync: only newer records are downloaded next time. */
  rev: number
  /** Every local record is merged with Drive at the next sync (first sync with this file). */
  uploadAll: boolean
  /** Local changes not uploaded yet: kind -> key -> change mark. A key whose record is gone is a deletion. */
  pending: Record<SyncKind, Record<string, number>>
  /**
   * For each pending key, the version this device had before its first unsynced change
   * (null: the record did not exist): the common base of the 3-way merge with Drive.
   */
  base: Record<SyncKind, Record<string, unknown>>
  /**
   * Version (null: deletion) of each key uploaded by a request whose reply never arrived (timeout,
   * app closed, reply ignored): Drive may hold it, and then it is this device's own, not a change
   * made elsewhere.
   */
  sent: Record<SyncKind, Record<string, unknown>>
  /** Download every record again at the next sync (the app was updated: unreadable records). */
  refetch: boolean
  /** Bumped when local data is replaced or cleared, or the link changes: older sync replies are ignored. */
  generation: number
  /**
   * Keys whose version on Drive this build cannot read (written by a newer app): never uploaded
   * from here, downloaded again once the app is updated. `unreadableBuild`: the build that tried.
   */
  unreadable: Record<SyncKind, string[]>
  unreadableBuild: string | null
  lastSyncAt: string | null
  /** Last sync error (shown in Impostazioni), cleared on success. */
  lastError: string | null
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
  /** Saving on Google Drive (per device: never exported in backups). */
  sync: DataSync
}
