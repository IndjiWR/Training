import { useEffect, useSyncExternalStore } from 'react'
import type { Plan } from '../plan/schema'
import {
  applySyncResponse,
  collectChanges,
  isTemporary,
  noteSent,
  pendingTotal,
  postSync,
  unreadableTotal,
  type AlignRecord,
  type PendingChanges,
} from '../lib/dataSync'
import { alignSessions, clearAllData, deleteAllLogs, replaceAllData } from './actions'
import { getState, setState, subscribe } from './store'
import type { AppData, SessionLog } from './types'
import { toast } from './ui'

/**
 * Keeps the logs (sessions, diary, pinned media) on Google Drive too, through the Apps Script:
 * uploads what changed here a few seconds after the change, downloads what changed on other
 * devices on open, every few minutes while the app is on screen and when it comes back, and sends
 * pending changes before the app is hidden. See lib/dataSync.ts for the merge rules.
 * Background problems are quiet: temporary ones are retried, others are shown once.
 */

/** After a change, wait for more before uploading (sets come every minute or so). */
const CHANGE_DELAY_MS = 6_000
/** While the app is on screen, look for changes made on other devices this often. */
const POLL_MS = 3 * 60_000
/** Back in the app (or the window gets focus) after this long: look for changes. */
const RESUME_PULL_MS = 60_000
/** Retry after a temporary problem (network, Drive busy or unavailable). */
const RETRY_MS = 60_000
/** Follow-up round (merges to send, changes made during the upload, a reply ignored). */
const AGAIN_MS = 500
/** Follow-up rounds in a row before slowing down (another device keeps changing the same records). */
const MAX_FOLLOW_UPS = 5

export type SyncOutcome = 'ok' | 'skipped' | 'offline' | 'error'

let inFlight: Promise<SyncOutcome> | null = null
/** A sync requested while another one runs: done right after it. */
let queued: { manual: boolean; full: boolean } | null = null
let timer: ReturnType<typeof setTimeout> | undefined
/** The scheduled sync also downloads when nothing is pending. */
let timerFull = false
let followUps = 0
let autoStarted = false
const syncingListeners = new Set<() => void>()

function emitSyncing(): void {
  for (const l of syncingListeners) l()
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Linked to Drive and saving turned on. */
export function dataSyncActive(s: AppData = getState()): boolean {
  return s.sync.enabled && s.settings.endpoint.trim() !== '' && s.settings.token.trim() !== ''
}

/** Changes of this device not on Drive yet. */
export function pendingCount(s: AppData = getState()): number {
  return pendingTotal(s)
}

/** Records on Drive this version of the app cannot read. */
export function unreadableCount(s: AppData = getState()): number {
  return unreadableTotal(s)
}

/** Sessions downloaded from Drive follow the exercises of this device's plan before any merge. */
function alignWith(plan: Plan | null): AlignRecord | undefined {
  if (!plan) return undefined
  return (kind, key, rec) =>
    kind === 'sessions' ? (alignSessions(plan, { [key]: rec as unknown as SessionLog })[key] as unknown as typeof rec) : rec
}

export interface SyncOptions {
  /** Started by the user: the outcome is always shown. */
  manual?: boolean
  /** Skip when there is nothing to upload (background uploads after a change). */
  onlyIfPending?: boolean
  /** The request may outlive the page being hidden (flush when leaving the app). */
  keepalive?: boolean
}

/** One sync: upload the pending changes, download and merge the changes made elsewhere. Never throws. */
export async function syncData(opts: SyncOptions = {}): Promise<SyncOutcome> {
  if (!dataSyncActive()) {
    if (opts.manual) toast('Collega Google Drive e attiva il salvataggio dei dati.', { tone: 'warn' })
    return 'skipped'
  }
  if (isOffline()) {
    if (opts.manual) {
      toast('Sei offline: i dati restano sul telefono e vanno su Drive quando torna la connessione.', {
        tone: 'warn',
      })
    }
    return 'offline'
  }
  if (inFlight) {
    queued = {
      manual: Boolean(opts.manual || queued?.manual),
      full: !opts.onlyIfPending || Boolean(queued?.full),
    }
    return inFlight
  }
  const state = getState()
  const sent = collectChanges(state)
  const fresh = state.sync.epoch == null || state.sync.uploadAll
  if (opts.onlyIfPending && sent.count === 0 && !fresh) return 'skipped'

  // Remembered before it leaves: if the reply is lost, Drive may hold these versions.
  if (sent.count > 0) setState((s) => ({ ...s, sync: noteSent(s.sync, sent) }))

  inFlight = run(state, sent, opts).finally(() => {
    inFlight = null
    emitSyncing()
    if (queued) {
      const next = queued
      queued = null
      void syncData({ manual: next.manual, onlyIfPending: !(next.manual || next.full) })
    }
  })
  emitSyncing()
  return inFlight
}

async function run(state: AppData, sent: PendingChanges, opts: SyncOptions): Promise<SyncOutcome> {
  const generation = state.sync.generation
  const firstSync = state.sync.lastSyncAt == null
  const res = await postSync(
    state.settings.endpoint,
    state.settings.token,
    { epoch: state.sync.epoch, since: state.sync.refetch ? 0 : state.sync.rev, changes: sent.records },
    { keepalive: opts.keepalive },
  )

  // Data replaced or cleared, or another link, while the request was out: this reply is stale.
  if (getState().sync.generation !== generation) {
    schedule(AGAIN_MS, true)
    return 'skipped'
  }

  if (!res.ok) {
    const temporary = isTemporary(res.kind)
    // A failed flush on the way out is retried at the next sync: not worth an error.
    if (!(opts.keepalive && temporary)) {
      const known = getState().sync.lastError === res.error
      setState((s) => (s.sync.lastError === res.error ? s : { ...s, sync: { ...s.sync, lastError: res.error } }))
      // Shown when asked, or once when it is a new, lasting problem (not again at every launch).
      if (opts.manual || (!temporary && !known)) toast(res.error, { tone: 'error', durationMs: 10_000 })
    }
    if (temporary) schedule(RETRY_MS, false)
    return 'error'
  }

  let received = 0
  let more = false
  try {
    setState((s) => {
      const applied = applySyncResponse(s, sent, res, Date.now(), __APP_BUILD__, alignWith(s.plan))
      received = applied.received
      more = applied.more
      const data = applied.data
      // Downloaded sessions follow the exercises of the current plan, like local ones.
      return received > 0 && data.plan ? { ...data, sessions: alignSessions(data.plan, data.sessions) } : data
    })
  } catch (err) {
    // A bug must not break the app: the local data is untouched, the reply is dropped.
    console.error(err)
    const error = 'Errore interno durante la sincronizzazione: i dati restano sul telefono.'
    setState((s) => ({ ...s, sync: { ...s.sync, lastError: error } }))
    if (opts.manual) toast(error, { tone: 'error' })
    return 'error'
  }
  if (more) {
    followUps++
    schedule(followUps > MAX_FOLLOW_UPS ? RETRY_MS : AGAIN_MS, false)
  } else {
    followUps = 0
  }

  if (opts.manual) {
    toast(
      received > 0
        ? `Dati sincronizzati: ${received} ${received === 1 ? 'aggiornamento' : 'aggiornamenti'} da Drive.`
        : 'Dati salvati su Google Drive ✓',
      { tone: 'success' },
    )
  } else if (firstSync && received > 0) {
    toast(`Dati scaricati da Google Drive: ${received} ${received === 1 ? 'elemento' : 'elementi'}.`, {
      tone: 'success',
    })
  }
  return 'ok'
}

/** Background sync after `delayMs` (restarted by every new request). full: also download. */
function schedule(delayMs: number, full: boolean): void {
  if (timer) clearTimeout(timer)
  timerFull ||= full
  timer = setTimeout(() => {
    timer = undefined
    const download = timerFull
    timerFull = false
    void syncData({ onlyIfPending: !download })
  }, delayMs)
}

/** Syncs until nothing is left to upload (merges take a second round). False: Drive not reached. */
async function flushPending(): Promise<boolean> {
  for (let round = 0; round < 3; round++) {
    const outcome = await syncData()
    if (inFlight) await inFlight
    if (outcome !== 'ok') return false
    if (pendingTotal(getState()) === 0) return true
  }
  return pendingTotal(getState()) === 0
}

/**
 * "Cancella tutti i dati" from this device only. With saving on Drive, the changes not on Drive yet
 * are saved first (the data then comes back from Drive): if that fails nothing is deleted.
 */
export async function clearThisDevice(): Promise<'cleared' | 'unsaved'> {
  if (dataSyncActive() && pendingTotal(getState()) > 0 && !(await flushPending())) return 'unsaved'
  clearAllData(true)
  return 'cleared'
}

/**
 * Backup import. With saving on Drive, this device first catches up with Drive (best effort), so
 * the backup replaces what Drive holds now, records added by other devices included.
 */
export async function importBackup(data: AppData): Promise<void> {
  if (dataSyncActive() && !isOffline()) {
    await syncData()
    if (inFlight) await inFlight
  }
  replaceAllData(data)
}

/** done: deleted on Drive too; queued: deleted here, Drive at the next sync; unreachable: nothing deleted. */
export type DeleteEverywhereOutcome = 'done' | 'queued' | 'unreachable'

/**
 * Deletes every log (sessions, diary, pinned media) on this device, on Drive and, at their next
 * sync, on the other devices; changes not saved yet on another device are kept. Brings this device
 * up to date first, so records it has not downloaded yet go too: without Drive nothing is deleted.
 */
export async function deleteLogsEverywhere(): Promise<DeleteEverywhereOutcome> {
  if (!dataSyncActive() || isOffline()) return 'unreachable'
  if ((await syncData()) !== 'ok') return 'unreachable'
  // A round queued meanwhile runs first: the deletion goes in the one after.
  if (inFlight && (await inFlight) !== 'ok') return 'unreachable'
  deleteAllLogs()
  return (await syncData()) === 'ok' ? 'done' : 'queued'
}

/**
 * Drive records an older build of the app could not read: once the app is updated, the next sync
 * downloads everything again (and merges it with this device's records).
 */
export function retryUnreadableRecords(build: string = __APP_BUILD__): void {
  setState((s) =>
    unreadableTotal(s) > 0 && s.sync.unreadableBuild !== build && !s.sync.refetch
      ? { ...s, sync: { ...s.sync, refetch: true } }
      : s,
  )
}

/** Shared state used to spot local changes and new links. */
function watched(s: AppData) {
  return {
    sessions: s.sessions,
    days: s.days,
    pins: s.pins,
    link: dataSyncActive(s) ? `${s.settings.endpoint}\n${s.settings.token}\n${s.sync.generation}` : '',
  }
}

function lastSyncAge(): number {
  const last = Date.parse(getState().sync.lastSyncAt ?? '')
  return Number.isNaN(last) ? Number.POSITIVE_INFINITY : Date.now() - last
}

/**
 * Automatic sync: on app open, after changes, periodically while on screen, when back online or
 * in the app, before leaving it. Call once from the app shell.
 */
export function useDataAutoSync(): void {
  useEffect(() => {
    // Module flag: React StrictMode runs effects twice, the app load must sync once.
    if (!autoStarted) {
      autoStarted = true
      retryUnreadableRecords()
      // After the plan request of the app load.
      schedule(1_500, true)
    }

    let last = watched(getState())
    const unsubscribe = subscribe(() => {
      const now = watched(getState())
      if (now.link && now.link !== last.link) {
        // Just linked, saving turned on, or data replaced: sync right away, with the download.
        schedule(300, true)
      } else if (now.sessions !== last.sessions || now.days !== last.days || now.pins !== last.pins) {
        schedule(CHANGE_DELAY_MS, false)
      }
      last = now
    })

    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const poll = setInterval(() => {
      if (visible() && lastSyncAge() >= POLL_MS - 1_000) void syncData()
    }, POLL_MS)
    const onOnline = () => void syncData()
    const onFocus = () => {
      if (lastSyncAge() > RESUME_PULL_MS) void syncData()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // iOS may suspend the app any moment now: send what is pending.
        if (pendingCount() > 0) void syncData({ onlyIfPending: true, keepalive: true })
        return
      }
      onFocus()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe()
      clearInterval(poll)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}

/** Test helper: waits for the running syncs, then drops the scheduled one (switching device state). */
export async function __settleSyncForTests(): Promise<void> {
  while (inFlight) await inFlight
  if (timer) clearTimeout(timer)
  timer = undefined
  timerFull = false
  queued = null
  followUps = 0
}

/** True while a sync with Drive is running (for spinners). */
export function useDataSyncing(): boolean {
  return useSyncExternalStore(
    (l) => {
      syncingListeners.add(l)
      return () => syncingListeners.delete(l)
    },
    () => inFlight !== null,
    () => false,
  )
}
