import { z } from 'zod'
import { DAY_TYPES, formatIssues, KINDS, UNITS } from '../plan/schema'
import { normalizeData } from '../state/store'
import type { AppData } from '../state/types'

export const BACKUP_FORMAT = 'training-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  /** AppData with settings.token blanked (the token never leaves the device). */
  data: AppData
}

export type ParseBackupResult = { ok: true; data: AppData } | { ok: false; error: string }

/* ───────────────────────── schema (loose records, strict shapes) ───────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `T | null`, accepting null or a missing field. */
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null)
/** boolean, missing/null -> false. */
const flag = z.boolean().nullish().transform((v) => v ?? false)
/** string, missing/null -> ''. */
const textField = z.string().nullish().transform((v) => v ?? '')
const num = nullable(z.number())
const str = nullable(z.string())
const dateKey = z.string().regex(ISO_DATE, 'data attesa nel formato AAAA-MM-GG')

const SideLogSchema = z.looseObject({ done: flag, value: num })
/** Missing/null side -> undefined (SetLog.dx/sx are optional, never null). */
const side = SideLogSchema.nullish().transform((v) => v ?? undefined)

const SetLogSchema = z.looseObject({
  done: flag,
  value: num,
  dx: side,
  sx: side,
  at: z.string().nullish(),
})

const ExerciseLogSchema = z.looseObject({
  index: z.number().int().nonnegative(),
  key: z.string(),
  name: textField,
  kind: z.enum(KINDS),
  unit: nullable(z.enum(UNITS)),
  measure: str,
  test: flag,
  perSide: flag,
  setsPlanned: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? 0),
  sets: z
    .array(SetLogSchema)
    .nullish()
    .transform((v) => v ?? []),
  text: z.string().optional(),
})

const SessionLogSchema = z.looseObject({
  planId: textField,
  dayType: z.enum(DAY_TYPES),
  dayTitle: str,
  startedAt: str,
  finishedAt: str,
  elbowPre: num,
  elbowOverride: nullable(z.enum(['green', 'yellow', 'red'])),
  rpe: num,
  elbowDuring: num,
  notes: textField,
  skipped: flag,
  exercises: z
    .record(z.string(), ExerciseLogSchema)
    .nullish()
    .transform((v) => v ?? {}),
})

const DayLogSchema = z.looseObject({
  weightKg: num,
  elbowNextMorning: num,
  sleepH: num,
})

const MediaPinSchema = z.looseObject({
  url: z.string().regex(/^https?:\/\/\S+$/i, 'il link deve iniziare con http:// o https://'),
  addedAt: textField,
})

const SettingsSchema = z.looseObject({
  endpoint: z.string().optional(),
  theme: z.enum(['dark', 'light']).optional(),
  sound: z.boolean().optional(),
  vibration: z.boolean().optional(),
})

const PlanMetaSchema = z.looseObject({
  source: nullable(z.enum(['remote', 'file', 'example'])),
  receivedAt: str,
  lastCheckAt: str,
  lastError: str,
})

const BackupDataSchema = z.object({
  settings: SettingsSchema,
  /** Re-validated by normalizeData (parsePlan): an invalid plan is dropped, the logs are kept. */
  plan: z.unknown(),
  planMeta: PlanMetaSchema,
  sessions: z.record(dateKey, SessionLogSchema),
  days: z.record(dateKey, DayLogSchema),
  pins: z.record(z.string().min(1), MediaPinSchema),
})

/* ───────────────────────── API ───────────────────────── */

/** Serialises the whole app data (sessions, day logs, plan, pins, settings without token). */
export function createBackup(data: AppData, exportedAt: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    data: { ...data, settings: { ...data.settings, token: '' } },
  }
}

/** "training-backup-YYYY-MM-DD.json" */
export function backupFileName(today: string): string {
  return `training-backup-${today}.json`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validates a parsed backup (zod; loose on inner records but strict on format/version and on
 * the top-level shape) and returns normalised AppData. The token in the result is
 * `currentToken` (backups never carry it). Never throws.
 */
export function parseBackup(
  json: unknown,
  currentToken: string,
): { ok: true; data: AppData } | { ok: false; error: string } {
  if (!isRecord(json)) return { ok: false, error: 'Il file non è un backup di Training.' }
  if ('days' in json && 'schema' in json) {
    return { ok: false, error: 'Questo file è una scheda, non un backup: importalo con «Importa scheda».' }
  }
  if (json.format !== BACKUP_FORMAT) {
    return { ok: false, error: `Il file non è un backup di Training (manca il formato «${BACKUP_FORMAT}»).` }
  }
  if (json.version !== BACKUP_VERSION) {
    const newer = typeof json.version === 'number' && json.version > BACKUP_VERSION
    return {
      ok: false,
      error: newer
        ? `Backup creato da una versione più recente dell’app (v${json.version}): aggiorna l’app e riprova.`
        : `Versione del backup non supportata (${JSON.stringify(json.version ?? null)}).`,
    }
  }
  if (!isRecord(json.data)) return { ok: false, error: 'Il backup non contiene i dati dell’app.' }

  const parsed = BackupDataSchema.safeParse(json.data)
  if (!parsed.success) {
    return { ok: false, error: `Il backup è danneggiato o incompleto:\n${formatIssues(parsed.error)}` }
  }

  const d = parsed.data
  // The record key is the source of truth for the date.
  const sessions = Object.fromEntries(Object.entries(d.sessions).map(([date, s]) => [date, { ...s, date }]))
  const days = Object.fromEntries(Object.entries(d.days).map(([date, l]) => [date, { ...l, date }]))
  const data = normalizeData({ ...d, version: 1, plan: d.plan ?? null, sessions, days })
  return { ok: true, data: { ...data, settings: { ...data.settings, token: currentToken } } }
}

/** Reads a user-picked backup .json File and validates it with parseBackup. Never throws. */
export async function readBackupFile(file: File, currentToken: string): Promise<ParseBackupResult> {
  let raw: string
  try {
    raw = await file.text()
  } catch {
    return { ok: false, error: 'Impossibile leggere il file selezionato.' }
  }
  let json: unknown
  try {
    json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch {
    return { ok: false, error: 'Il file non è un JSON valido: scegli un file training-backup-AAAA-MM-GG.json.' }
  }
  return parseBackup(json, currentToken)
}

/** Triggers a browser download of `text` as a .json file. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.hidden = true
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    // Revoke later: some browsers (Safari, Firefox) start reading the blob after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
