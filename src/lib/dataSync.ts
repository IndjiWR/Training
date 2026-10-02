import { z } from 'zod'
import type { AppData, DataSync, SyncKind } from '../state/types'
import { SYNC_KINDS } from '../state/types'
import { DayLogSchema, MediaPinSchema, SessionLogSchema } from './backup'
import { BLOCKED_HINT, buildPlanUrl, FETCH_TIMEOUT_MS, probeScript } from './sync'

/**
 * Saving of the logs on Google Drive through the same Apps Script that serves the plan.
 *
 * One POST uploads this device's pending records and downloads the ones changed elsewhere. Drive
 * accepts a record only if this device had seen its latest version (its revision is not newer than
 * the device's `since`); otherwise it answers "conflict" with the newer version, the device merges
 * both (3-way, against the version it had before its own change) and sends the merge next round.
 * So nothing is overwritten blindly: logged sets are merged, never lost. Device clocks matter only
 * when the same value was changed on two devices (the later change wins). A different file
 * identity (`epoch`: file recreated or restored on Drive) makes the device merge all its records
 * with the file again.
 */

export const DATA_FILE_NAME = 'training-dati.json'

/** Bodies above this are not sent with `keepalive` (browsers cap keepalive requests at 64 KB). */
const KEEPALIVE_MAX_BYTES = 60_000

type Rec = Record<string, unknown>

export interface Tombstone {
  deleted: true
  updatedAt: number
}

/** Records by kind and key; a deletion travels as a Tombstone. */
export type SyncRecords = Record<SyncKind, Record<string, Rec>>

export function emptyRecords(): SyncRecords {
  return { sessions: {}, days: {}, pins: {} }
}

export function isTombstone(v: unknown): v is Tombstone {
  return v != null && typeof v === 'object' && (v as { deleted?: unknown }).deleted === true
}

/** Time of the last change; records saved before sync existed count as 1 (the oldest). */
export function stampOf(rec: { updatedAt?: unknown } | null | undefined): number {
  const t = rec?.updatedAt
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 1
}

/** Stamp for a new version of `prev`: now, and always after the version it replaces. */
export function nextStamp(prev: { updatedAt?: unknown } | null | undefined): number {
  return Math.max(Date.now(), stampOf(prev) + 1)
}

const isObj = (v: unknown): v is Rec => v != null && typeof v === 'object' && !Array.isArray(v)

/**
 * Deep equality ignoring key order, the top-level `updatedAt` (metadata) and the difference between
 * a missing key, `undefined` and `null`.
 */
export function same(a: unknown, b: unknown, top = true): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i], false))
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (top && k === 'updatedAt') continue
      if (!same(a[k], b[k], false)) return false
    }
    return true
  }
  return false
}

/* ───────────────────────── 3-way merge ───────────────────────── */

/** Field value after a 3-way merge; `conflict` decides when both sides changed it differently. */
function pick3(base: unknown, local: unknown, remote: unknown, conflict: () => unknown): unknown {
  if (same(local, remote, false)) return local
  if (same(local, base, false)) return remote
  if (same(remote, base, false)) return local
  return conflict()
}

function joinNotes(a: unknown, b: unknown): string {
  const x = typeof a === 'string' ? a.trim() : ''
  const y = typeof b === 'string' ? b.trim() : ''
  if (!x || y.includes(x)) return y
  if (!y || x.includes(y)) return x
  return `${x}\n${y}`
}

type SetLike = { done?: unknown; at?: unknown; dx?: unknown; sx?: unknown }

function laterAt(a: unknown, b: unknown): unknown {
  if (typeof a !== 'string') return b
  if (typeof b !== 'string') return a
  return a >= b ? a : b
}

/** The same side of a set changed differently on two devices: the done one wins. */
function pickSide(x: Rec | undefined, y: Rec | undefined): Rec | undefined {
  if (!x) return y
  if (!y) return x
  if (Boolean(x.done) !== Boolean(y.done)) return x.done ? x : y
  return x
}

/**
 * One set (3-way against the base set): what only one device changed is kept; when both changed it
 * differently the done one wins, side by side for per-side sets.
 */
function mergeSet(base: Rec | undefined, a: Rec | undefined, b: Rec | undefined): Rec | undefined {
  return pick3(base, a, b, () => {
    if (!a) return b
    if (!b) return a
    const sa = a as SetLike
    const sb = b as SetLike
    const s0 = (base ?? {}) as SetLike
    if (sa.dx || sa.sx || sb.dx || sb.sx) {
      const dx = pick3(s0.dx, sa.dx, sb.dx, () => pickSide(sa.dx as Rec | undefined, sb.dx as Rec | undefined))
      const sx = pick3(s0.sx, sa.sx, sb.sx, () => pickSide(sa.sx as Rec | undefined, sb.sx as Rec | undefined))
      const done = Boolean((dx as SetLike | undefined)?.done && (sx as SetLike | undefined)?.done)
      return { ...b, ...a, dx, sx, done, at: laterAt(sa.at, sb.at) }
    }
    if (Boolean(sa.done) !== Boolean(sb.done)) return sa.done ? a : b
    if (sa.done && typeof sb.at === 'string' && (typeof sa.at !== 'string' || sb.at > sa.at)) return b
    return a
  }) as Rec | undefined
}

const setsOf = (log: Rec | undefined): Rec[] => (log && Array.isArray(log.sets) ? (log.sets as Rec[]) : [])

/** One exercise logged on two devices: sets merged one by one against the base, nothing done is lost. */
function mergeLog(base: Rec | undefined, local: Rec, remote: Rec): Rec {
  const bs = setsOf(base)
  const ls = setsOf(local)
  const rs = setsOf(remote)
  const merged: (Rec | undefined)[] = []
  for (let i = 0; i < Math.max(bs.length, ls.length, rs.length); i++) merged.push(mergeSet(bs[i], ls[i], rs[i]))
  while (merged.length > 0 && !merged[merged.length - 1]) merged.pop()
  // A row removed in the middle keeps the following sets in their place.
  const sets = merged.map((set) => set ?? { done: false, value: null })
  const out: Rec = { ...remote, ...local, sets }
  out.setsPlanned = Math.max(Number(local.setsPlanned) || 0, Number(remote.setsPlanned) || 0)
  const text = pick3(base?.text, local.text, remote.text, () =>
    typeof local.text === 'string' && local.text.trim() ? local.text : remote.text,
  )
  if (text === undefined) delete out.text
  else out.text = text
  return out
}

function mergeExercises(base: unknown, local: unknown, remote: unknown): Rec {
  const b = isObj(base) ? base : {}
  const l = isObj(local) ? local : {}
  const r = isObj(remote) ? remote : {}
  const out: Rec = {}
  for (const id of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const v = pick3(b[id], l[id], r[id], () =>
      !isObj(l[id]) ? r[id] : !isObj(r[id]) ? l[id] : mergeLog(isObj(b[id]) ? b[id] : undefined, l[id], r[id]),
    )
    if (v != null) out[id] = v
  }
  return out
}

const SESSION_FIELDS = [
  'planId',
  'dayType',
  'dayTitle',
  'startedAt',
  'finishedAt',
  'elbowPre',
  'elbowOverride',
  'rpe',
  'elbowDuring',
  'skipped',
] as const
const DAY_FIELDS = ['weightKg', 'elbowNextMorning', 'sleepH'] as const

/** Both devices changed the same record: field by field, the newer copy settles real collisions. */
function mergeFields(base: Rec | null, local: Rec, remote: Rec, kind: 'sessions' | 'days'): Rec {
  const localNewer = stampOf(local) >= stampOf(remote)
  const out: Rec = { ...remote, ...local }
  for (const f of kind === 'sessions' ? SESSION_FIELDS : DAY_FIELDS) {
    out[f] = pick3(base?.[f], local[f], remote[f], () => {
      if (f === 'startedAt') {
        const times = [local[f], remote[f]].filter((t): t is string => typeof t === 'string').sort()
        return times[0] ?? null
      }
      return localNewer ? local[f] : remote[f]
    })
  }
  if (kind === 'sessions') {
    out.notes = pick3(base?.notes, local.notes, remote.notes, () => joinNotes(local.notes, remote.notes))
    out.exercises = mergeExercises(base?.exercises, local.exercises, remote.exercises)
  }
  out.updatedAt = Math.max(stampOf(local), stampOf(remote)) + 1
  return out
}

/**
 * 3-way merge of one record (null = absent/deleted). `base` is the version this device had
 * before its own unsynced change. An edit always beats a deletion.
 */
export function merge3(kind: SyncKind, base: Rec | null, local: Rec | null, remote: Rec | null): Rec | null {
  if (same(local, remote)) return remote
  if (same(local, base)) return remote
  if (same(remote, base)) return local
  if (!local) return remote
  if (!remote) return local
  if (kind === 'pins') return stampOf(local) >= stampOf(remote) ? local : remote
  return mergeFields(base, local, remote, kind)
}

/* ───────────────────────── upload ───────────────────────── */

export interface PendingChanges {
  records: SyncRecords
  count: number
  /** The pending marks when the upload was prepared (to tell what changed meanwhile). */
  marks: Record<SyncKind, Record<string, number>>
  /** Every local record was sent (first sync with this Drive file). */
  uploadAll: boolean
}

/**
 * What to upload: the pending keys (every record when sync.uploadAll); a gone record as a tombstone.
 * Keys whose version on Drive this build cannot read are never sent: they would overwrite it.
 */
export function collectChanges(data: AppData): PendingChanges {
  const records = emptyRecords()
  const marks = { sessions: {}, days: {}, pins: {} } as Record<SyncKind, Record<string, number>>
  let count = 0
  for (const kind of SYNC_KINDS) {
    const live = data[kind] as unknown as Record<string, Rec>
    const pending = data.sync.pending[kind]
    const blocked = new Set(data.sync.unreadable[kind])
    marks[kind] = { ...pending }
    const keys = new Set(Object.keys(pending))
    if (data.sync.uploadAll) for (const key of Object.keys(live)) keys.add(key)
    for (const key of keys) {
      if (blocked.has(key)) continue
      if (Object.hasOwn(live, key) && live[key]) {
        records[kind][key] = { ...live[key], updatedAt: stampOf(live[key]) }
      } else if (Object.hasOwn(pending, key)) {
        records[kind][key] = { deleted: true, updatedAt: pending[key] } satisfies Tombstone
      } else {
        continue
      }
      count++
    }
  }
  return { records, count, marks, uploadAll: data.sync.uploadAll }
}

/**
 * Records what a request uploads, before it is sent. If its reply never arrives, Drive may hold
 * that version: the next reply then recognises it as this device's own. Only the first upload
 * without a reply counts (with the same `since`, later ones can only conflict with it).
 */
export function noteSent(sync: DataSync, request: PendingChanges): DataSync {
  let sent = sync.sent
  for (const kind of SYNC_KINDS) {
    for (const [key, rec] of Object.entries(request.records[kind])) {
      if (Object.hasOwn(sent[kind], key)) continue
      sent = { ...sent, [kind]: { ...sent[kind], [key]: isTombstone(rec) ? null : rec } }
    }
  }
  return sent === sync.sent ? sync : { ...sync, sent }
}

/** Number of local changes not on Drive yet (records waiting for the first sync not counted). */
export function pendingTotal(data: AppData): number {
  return SYNC_KINDS.reduce((n, kind) => n + Object.keys(data.sync.pending[kind]).length, 0)
}

/** Records on Drive this build cannot read. */
export function unreadableTotal(data: AppData): number {
  return SYNC_KINDS.reduce((n, kind) => n + data.sync.unreadable[kind].length, 0)
}

/* ───────────────────────── reply ───────────────────────── */

export interface SyncOk {
  ok: true
  epoch: string
  rev: number
  /** The file is new to this device (first sync, recreated or restored): everything was sent back. */
  reset: boolean
  accepted: Record<SyncKind, string[]>
  conflicts: Record<SyncKind, string[]>
  records: SyncRecords
  /** Keys of downloaded records this build cannot read (written by a newer app version). */
  skipped: Record<SyncKind, string[]>
}

export interface SyncApplied {
  data: AppData
  /** Local records changed by the download. */
  received: number
  /** Pending changes left (merges, edits made during the upload): another round is needed. */
  more: boolean
}

/** Puts a downloaded record in this device's terms (sessions: onto the exercises of its plan). */
export type AlignRecord = (kind: SyncKind, key: string, rec: Rec) => Rec

const asIs: AlignRecord = (_kind, _key, rec) => rec

/**
 * Applies a sync reply to the latest local data (pure). Uploads accepted by Drive are
 * acknowledged; conflicts and downloaded records are merged into pending local changes (3-way)
 * or adopted when there is none; a new file identity merges every local record with it.
 */
export function applySyncResponse(
  data: AppData,
  request: PendingChanges,
  res: SyncOk,
  now: number,
  build: string,
  align: AlignRecord = asIs,
): SyncApplied {
  const copy = <T>(by: Record<SyncKind, Record<string, T>>) => ({
    sessions: { ...by.sessions },
    days: { ...by.days },
    pins: { ...by.pins },
  })
  const pending = copy(data.sync.pending)
  const base = copy(data.sync.base)
  const sent = copy(data.sync.sent)
  const live = copy({
    sessions: data.sessions as unknown as Record<string, Rec>,
    days: data.days as unknown as Record<string, Rec>,
    pins: data.pins as unknown as Record<string, Rec>,
  })
  const unreadable = {
    sessions: new Set(data.sync.unreadable.sessions),
    days: new Set(data.sync.unreadable.days),
    pins: new Set(data.sync.unreadable.pins),
  }
  const inTerms = (kind: SyncKind, key: string, rec: unknown): Rec | null => (isObj(rec) ? align(kind, key, rec) : null)
  let mark = now
  const nextMark = () => ++mark
  let received = 0

  const apply = (kind: SyncKind, key: string, rec: Rec | null) => {
    if (rec == null) delete live[kind][key]
    else live[kind][key] = kind === 'pins' ? rec : { ...rec, date: key }
    received++
  }

  for (const kind of SYNC_KINDS) {
    const P = pending[kind]
    const B = base[kind]
    const L = live[kind]
    const mine = data.sync.sent[kind]
    const accepted = new Set(res.accepted[kind])

    // This reply answers every upload of the request.
    for (const key of Object.keys(request.records[kind])) delete sent[kind][key]

    // Uploads accepted by Drive: done, unless changed again during the upload.
    for (const key of accepted) {
      const sentRec = request.records[kind][key]
      if (!sentRec) continue
      if (!Object.hasOwn(P, key) || P[key] === request.marks[kind][key]) {
        delete P[key]
        delete B[key]
      } else {
        B[key] = isTombstone(sentRec) ? null : sentRec
      }
    }

    // A file new to this device: every local record is merged with it, none overwritten.
    if (res.reset) {
      for (const key of Object.keys(L)) if (!accepted.has(key) && !Object.hasOwn(P, key)) P[key] = nextMark()
      for (const key of Object.keys(P)) if (!accepted.has(key)) B[key] = null
    }

    // Uploads refused (Drive had a newer version): stay pending, merged below with that version.
    for (const key of res.conflicts[kind]) {
      if (!Object.hasOwn(P, key)) P[key] = nextMark()
      if (request.uploadAll || !Object.hasOwn(B, key)) B[key] = null
    }

    for (const key of res.skipped[kind]) unreadable[kind].add(key)

    // Downloads.
    for (const [key, rec] of Object.entries(res.records[kind])) {
      unreadable[kind].delete(key)
      const remote = isTombstone(rec) ? null : align(kind, key, rec)
      const local = Object.hasOwn(L, key) ? L[key] : null
      if (!Object.hasOwn(P, key)) {
        if (!same(local, remote)) apply(kind, key, remote)
        continue
      }
      // Drive holds this device's own upload whose reply was lost: only what changed here since counts.
      const own = Object.hasOwn(mine, key) && same(inTerms(kind, key, mine[key]), remote)
      const common = own ? remote : Object.hasOwn(B, key) ? inTerms(kind, key, B[key]) : null
      const merged = merge3(kind, common, local, remote)
      if (same(merged, remote)) {
        if (!same(local, remote)) apply(kind, key, remote)
        delete P[key]
        delete B[key]
      } else {
        if (!same(local, merged)) apply(kind, key, merged)
        P[key] = nextMark()
        B[key] = remote
      }
    }
  }

  const blocked = {
    sessions: [...unreadable.sessions].sort(),
    days: [...unreadable.days].sort(),
    pins: [...unreadable.pins].sort(),
  }
  const anyBlocked = SYNC_KINDS.some((kind) => blocked[kind].length > 0)
  // Changes to unreadable keys wait for an updated app: they do not need another round.
  const more = SYNC_KINDS.some((kind) => Object.keys(pending[kind]).some((key) => !unreadable[kind].has(key)))
  // Another tab may have synced further meanwhile (same file): never step back.
  const rev = !res.reset && res.epoch === data.sync.epoch ? Math.max(data.sync.rev, res.rev) : res.rev
  const next: AppData = {
    ...data,
    sessions: live.sessions as unknown as AppData['sessions'],
    days: live.days as unknown as AppData['days'],
    pins: live.pins as unknown as AppData['pins'],
    sync: {
      ...data.sync,
      epoch: res.epoch,
      rev,
      uploadAll: false,
      pending,
      base,
      sent,
      refetch: false,
      unreadable: blocked,
      unreadableBuild: anyBlocked ? build : null,
      lastSyncAt: new Date(now).toISOString(),
      lastError: null,
    },
  }
  return { data: next, received, more }
}

/* ───────────────────────── transport ───────────────────────── */

export type SyncErrorKind =
  | 'network'
  | 'unavailable'
  | 'blocked'
  | 'http'
  | 'unauthorized'
  | 'outdated'
  | 'busy'
  | 'permission'
  | 'corrupt'
  | 'invalid'

/** Problems that go away by themselves: retried silently in the background. */
export function isTemporary(kind: SyncErrorKind): boolean {
  return kind === 'network' || kind === 'unavailable' || kind === 'busy'
}

export type SyncResponse = SyncOk | { ok: false; kind: SyncErrorKind; error: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TombstoneSchema = z.object({ deleted: z.literal(true), updatedAt: z.number() })
const RECORD_SCHEMAS = { sessions: SessionLogSchema, days: DayLogSchema, pins: MediaPinSchema } as const

/**
 * Valid records of a downloaded kind. A record that fails validation is never fatal: its key is
 * returned as unreadable (written by a newer app version). Keys this app never uses are ignored.
 */
function readKind(kind: SyncKind, raw: unknown): { records: Record<string, Rec>; unreadable: string[] } {
  const records: Record<string, Rec> = {}
  const unreadable: string[] = []
  if (!isObj(raw)) return { records, unreadable }
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__' || (kind !== 'pins' && !ISO_DATE.test(key))) continue
    const tomb = TombstoneSchema.safeParse(value)
    if (tomb.success) {
      records[key] = tomb.data
      continue
    }
    const rec = RECORD_SCHEMAS[kind].safeParse(value)
    if (rec.success) records[key] = rec.data as Rec
    else unreadable.push(key)
  }
  return { records, unreadable }
}

function readKeys(raw: unknown): Record<SyncKind, string[]> {
  const out = { sessions: [], days: [], pins: [] } as Record<SyncKind, string[]>
  if (!isObj(raw)) return out
  for (const kind of SYNC_KINDS) {
    const list = raw[kind]
    if (Array.isArray(list)) out[kind] = list.filter((k): k is string => typeof k === 'string' && k !== '__proto__')
  }
  return out
}

const UPDATE_SCRIPT =
  'Aggiornalo dal computer: Impostazioni → «Crea il collegamento dal computer» → «Hai già lo script?» (stesso progetto, poi «setup» e una nuova versione del deployment: l’URL resta lo stesso).'

const SERVER_ERRORS: Record<string, { kind: SyncErrorKind; error: string }> = {
  unauthorized: { kind: 'unauthorized', error: 'Token non valido: ricollega il dispositivo a Google Drive.' },
  busy: { kind: 'busy', error: 'Google Drive è occupato con un altro salvataggio: riprovo tra poco.' },
  no_write_permission: {
    kind: 'permission',
    error: `Lo script non ha il permesso di scrivere su Drive (forse ha ancora il manifest di sola lettura). ${UPDATE_SCRIPT}`,
  },
  data_corrupt: {
    kind: 'corrupt',
    error: `Il file ${DATA_FILE_NAME} su Drive è danneggiato: non lo sovrascrivo. Ripristina una versione precedente da Drive (Gestisci versioni) oppure eliminalo: i dati di questo dispositivo tornano su Drive da soli.`,
  },
  not_configured: { kind: 'http', error: 'Lo script non è configurato (manca FOLDER_ID): esegui «setup».' },
  folder_unavailable: { kind: 'http', error: 'La cartella delle schede non è accessibile allo script.' },
  invalid_request: { kind: 'http', error: 'Richiesta non valida per lo script: aggiorna l’app.' },
}

const OUTDATED = `Lo script su Google Drive è di una versione precedente e non sa ancora salvare i dati. ${UPDATE_SCRIPT}`

/**
 * One sync round trip: POST without custom headers (the string body is sent as text/plain, a CORS
 * "simple request" that Apps Script can answer; the token stays a query parameter as for the plan).
 * Never throws.
 */
export async function postSync(
  endpoint: string,
  token: string,
  request: { epoch: string | null; since: number; changes: SyncRecords },
  options: { fetchImpl?: typeof fetch; keepalive?: boolean } = {},
): Promise<SyncResponse> {
  const fetchImpl = options.fetchImpl ?? fetch
  let url: string
  try {
    url = buildPlanUrl(endpoint, token)
  } catch (err) {
    return { ok: false, kind: 'http', error: err instanceof Error ? err.message : String(err) }
  }
  const body = JSON.stringify({ action: 'sync', v: 2, epoch: request.epoch, since: request.since, changes: request.changes })

  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : undefined
  let status: number
  let text: string
  try {
    const init: RequestInit = { method: 'POST', body, redirect: 'follow', cache: 'no-store', credentials: 'omit' }
    if (controller) init.signal = controller.signal
    if (options.keepalive && body.length <= KEEPALIVE_MAX_BYTES) init.keepalive = true
    const res = await fetchImpl(url, init)
    status = res.status
    text = await res.text()
  } catch {
    if (timer) clearTimeout(timer)
    // Why? Not asked for a flush on the way out (the page is going away) nor after a timeout.
    if (!options.keepalive && !controller?.signal.aborted) {
      const probe = await probeScript(endpoint, fetchImpl)
      // The plan request works, saving does not: the published script has no doPost (Google's
      // "function not found" page has no CORS headers, so it cannot be read).
      if (probe === 'json') return { ok: false, kind: 'outdated', error: OUTDATED }
      if (probe === 'page') {
        return {
          ok: false,
          kind: 'blocked',
          error: `Lo script risponde con una pagina di Google invece che con i dati. ${BLOCKED_HINT}`,
        }
      }
    }
    return { ok: false, kind: 'network', error: 'Impossibile raggiungere Google Drive per salvare i dati.' }
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (status === 429 || status >= 500) {
    return { ok: false, kind: 'unavailable', error: `Google Drive non risponde (errore ${status}): riprovo più tardi.` }
  }
  if (status < 200 || status >= 300) {
    return { ok: false, kind: 'http', error: `Google Drive ha risposto con errore ${status}.` }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // The script without doPost answers with an HTML page naming it; other pages are temporary.
    return /doPost/i.test(text)
      ? { ok: false, kind: 'outdated', error: OUTDATED }
      : { ok: false, kind: 'unavailable', error: 'Google Drive ha risposto in modo inatteso: riprovo più tardi.' }
  }
  if (!isObj(json)) return { ok: false, kind: 'invalid', error: 'Risposta non valida da Google Drive.' }
  if (typeof json.error === 'string') {
    const known = SERVER_ERRORS[json.error]
    if (known) return { ok: false, ...known }
    const detail = typeof json.message === 'string' ? `: ${json.message}` : ''
    if (json.error === 'internal') {
      return { ok: false, kind: 'unavailable', error: `Errore temporaneo dello script${detail}` }
    }
    return { ok: false, kind: 'http', error: `Errore dello script (${json.error})${detail}` }
  }
  if (json.ok !== true || typeof json.epoch !== 'string' || typeof json.rev !== 'number' || !isObj(json.records)) {
    // An older script answers without the sync fields (or with the plan).
    return { ok: false, kind: 'outdated', error: OUTDATED }
  }

  const records = emptyRecords()
  const skipped = { sessions: [], days: [], pins: [] } as Record<SyncKind, string[]>
  for (const kind of SYNC_KINDS) {
    const read = readKind(kind, json.records[kind])
    records[kind] = read.records
    skipped[kind] = read.unreadable
  }
  return {
    ok: true,
    epoch: json.epoch,
    rev: json.rev,
    reset: json.reset === true,
    accepted: readKeys(json.accepted),
    conflicts: readKeys(json.conflicts),
    records,
    skipped,
  }
}
