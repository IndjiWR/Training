import { useEffect, useSyncExternalStore } from 'react'
import { parsePlan, type Plan } from '../plan/schema'
import { nowISO, TIME_ZONE } from '../lib/date'
import { fetchPlan, isNewerPlan, readPlanFile, type FetchPlanResult } from '../lib/sync'
import { setPlan, setPlanMeta, updateSettings } from './actions'
import { getState, subscribe } from './store'
import type { SessionLog } from './types'
import { toast, type Toast } from './ui'

/**
 * Plan sync orchestration (store + toasts). See lib/sync.ts for the pure parts.
 */

/** On 'visibilitychange' a refresh runs only when the last successful check is older than this. */
const STALE_MS = 15 * 60_000
/** …and never more often than this, so a persistent failure does not refetch on every app switch. */
const MIN_AUTO_RETRY_MS = 60_000
/** A started, unfinished session younger than this counts as a workout in progress. */
export const ACTIVE_SESSION_MS = 3 * 60 * 60_000
const SETTINGS_HASH = '#/impostazioni'

type FetchFailure = Extract<FetchPlanResult, { ok: false }>

let inFlight: Promise<void> | null = null
/** True when at least one caller of the in-flight refresh was manual. */
let inFlightManual = false
let lastAttemptAt = 0
let autoStarted = false
/** Newer remote plan held back while a workout is in progress (auto refresh only). */
let pendingPlan: Plan | null = null
/** Error messages already toasted by auto refreshes in this app session (no nagging). */
const autoErrorsShown = new Set<string>()
const syncingListeners = new Set<() => void>()

/* ───────────────────────── helpers ───────────────────────── */

const generatedFormat = new Intl.DateTimeFormat('it-IT', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** "gio 1 ott, 17:33" (Europe/Rome); the raw string when unparsable. */
function formatGenerated(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? iso : generatedFormat.format(t)
}

function planLabel(plan: Plan): string {
  return `${plan.title ?? `scheda ${plan.id}`} (generata ${formatGenerated(plan.generated_at)})`
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function settingsAction(label: string): Toast['action'] {
  if (typeof location === 'undefined' || location.hash === SETTINGS_HASH) return undefined
  return {
    label,
    run: () => {
      location.hash = SETTINGS_HASH
    },
  }
}

/** First lines of a (possibly long, multi-line zod) error: the full text is in Impostazioni. */
function shortError(error: string, maxLines = 3): string {
  const lines = error.split('\n')
  return lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n…` : error
}

function emitSyncing(): void {
  for (const l of syncingListeners) l()
}

function subscribeSyncing(listener: () => void): () => void {
  syncingListeners.add(listener)
  return () => syncingListeners.delete(listener)
}

/**
 * Start time (epoch ms) of the most recently started open session — started, not finished, not
 * skipped — or null when there is none. Pure: a workout is in progress while
 * `now - openSessionStart(sessions) < ACTIVE_SESSION_MS`.
 */
export function openSessionStart(sessions: Record<string, SessionLog>): number | null {
  let latest: number | null = null
  for (const s of Object.values(sessions)) {
    if (!s.startedAt || s.finishedAt || s.skipped) continue
    const started = Date.parse(s.startedAt)
    if (!Number.isNaN(started) && (latest == null || started > latest)) latest = started
  }
  return latest
}

function workoutInProgress(): boolean {
  const started = openSessionStart(getState().sessions)
  return started != null && Date.now() - started < ACTIVE_SESSION_MS
}

/** A remote plan replaces the current one when newer, or when the current one is just the example. */
function shouldReplace(incoming: Plan): boolean {
  const { plan, planMeta } = getState()
  return isNewerPlan(incoming, plan) || planMeta.source === 'example'
}

function applyRemotePlan(plan: Plan): void {
  pendingPlan = null
  const newer = isNewerPlan(plan, getState().plan)
  setPlan(plan, 'remote')
  toast(newer ? `Nuova scheda: ${planLabel(plan)}` : `Scheda scaricata da Drive: ${planLabel(plan)}`, {
    tone: 'success',
    durationMs: 6000,
  })
}

/** Applies a held-back plan once no workout is in progress any more. */
function applyPendingIfIdle(): void {
  if (!pendingPlan || workoutInProgress()) return
  const plan = pendingPlan
  pendingPlan = null
  if (shouldReplace(plan)) applyRemotePlan(plan)
}

function reportError(failure: FetchFailure, manual: boolean): void {
  const hasPlan = getState().plan != null
  if (failure.kind === 'offline') {
    if (manual) toast(offlineMessage(hasPlan), { tone: 'warn' })
    return
  }
  setPlanMeta({ lastError: failure.error })
  // Configuration/contract problems are shown even on auto refresh; transient network errors are not.
  const loud = failure.kind !== 'network'
  if (!manual) {
    if (!loud || autoErrorsShown.has(failure.error)) return
    autoErrorsShown.add(failure.error)
  }
  const tail = hasPlan
    ? 'Continuo con la scheda salvata.'
    : 'Nessuna scheda salvata: puoi importarne una da file in Impostazioni.'
  toast(`${shortError(failure.error)}\n${tail}`, {
    tone: 'error',
    durationMs: 10_000,
    action: settingsAction('Dettagli'),
  })
}

function offlineMessage(hasPlan: boolean): string {
  return hasPlan
    ? 'Sei offline: continuo con la scheda salvata'
    : 'Sei offline: scaricherò la scheda quando torna la connessione'
}

async function runRefresh(): Promise<void> {
  const { endpoint, token } = getState().settings
  let result: FetchPlanResult
  try {
    result = await fetchPlan(endpoint, token)
  } catch {
    // fetchPlan never throws; this only guards against an unexpected runtime failure.
    result = { ok: false, kind: 'network', error: 'Errore imprevisto durante il download della scheda.' }
  }
  const manual = inFlightManual

  if (!result.ok) {
    reportError(result, manual)
    return
  }

  autoErrorsShown.clear()
  setPlanMeta({ lastCheckAt: nowISO(), lastError: null })
  const incoming = result.plan

  if (shouldReplace(incoming)) {
    if (!manual && workoutInProgress()) {
      const alreadyAnnounced =
        pendingPlan?.id === incoming.id && pendingPlan.generated_at === incoming.generated_at
      pendingPlan = incoming
      if (alreadyAnnounced) return
      toast(`Nuova scheda disponibile: ${planLabel(incoming)}. La carico a fine allenamento.`, {
        tone: 'info',
        durationMs: 8000,
        action: {
          label: 'Carica ora',
          run: () => {
            if (pendingPlan) applyRemotePlan(pendingPlan)
          },
        },
      })
      return
    }
    applyRemotePlan(incoming)
    return
  }

  pendingPlan = null
  if (!manual) return
  const current = getState().plan
  if (current && isNewerPlan(current, incoming)) {
    toast('La scheda salvata è più recente di quella su Drive: la tengo.', { tone: 'info' })
  } else {
    toast('La scheda è già aggiornata', { tone: 'success' })
  }
}

/* ───────────────────────── API ───────────────────────── */

/** Fetches the newest plan from the configured endpoint. manual=true -> always toasts the outcome. */
export async function refreshPlan(opts: { manual: boolean }): Promise<void> {
  if (inFlight) {
    // Join the running request; a manual caller still gets its feedback.
    if (opts.manual) inFlightManual = true
    return inFlight
  }

  const { settings, plan } = getState()
  if (!settings.endpoint.trim() || !settings.token.trim()) {
    if (opts.manual) {
      toast('Inserisci URL dello script e token in Impostazioni per scaricare la scheda da Drive.', {
        tone: 'warn',
        durationMs: 6000,
        action: settingsAction('Impostazioni'),
      })
    }
    return
  }
  if (isOffline()) {
    if (opts.manual) toast(offlineMessage(plan != null), { tone: 'warn' })
    return
  }

  inFlightManual = opts.manual
  lastAttemptAt = Date.now()
  const run = runRefresh().finally(() => {
    inFlight = null
    inFlightManual = false
    emitSyncing()
  })
  inFlight = run
  emitSyncing()
  return run
}

export type ConnectOutcome = 'ok' | 'offline' | 'error'

/**
 * Saves a new collegamento (endpoint + token) and downloads the plan right away. The outcome is
 * also toasted by refreshPlan; 'error' leaves the details in planMeta.lastError.
 */
export async function connectDrive(endpoint: string, token: string): Promise<ConnectOutcome> {
  // A refresh already running uses the previous settings: let it finish, then fetch again.
  if (inFlight) await inFlight.catch(() => undefined)
  updateSettings({ endpoint, token })
  if (isOffline()) {
    toast('Collegamento salvato. Sei offline: scarico la scheda appena torna la connessione.', { tone: 'info' })
    return 'offline'
  }
  const before = getState().planMeta.lastCheckAt
  await refreshPlan({ manual: true })
  const meta = getState().planMeta
  return meta.lastError === null && meta.lastCheckAt !== before ? 'ok' : 'error'
}

/** Auto sync: once on app open and on every 'online' event. Call once from the app shell. */
export function usePlanAutoSync(): void {
  useEffect(() => {
    // Module flag: React StrictMode runs effects twice, the app load must fetch once.
    if (!autoStarted) {
      autoStarted = true
      void refreshPlan({ manual: false })
    }

    const onOnline = () => {
      void refreshPlan({ manual: false })
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const last = getState().planMeta.lastCheckAt
      const lastCheck = last ? Date.parse(last) : Number.NaN
      const now = Date.now()
      const stale = Number.isNaN(lastCheck) || now - lastCheck > STALE_MS
      if (stale && now - lastAttemptAt > MIN_AUTO_RETRY_MS) void refreshPlan({ manual: false })
    }
    // A held-back plan is applied as soon as the workout ends (deferred out of the store emit).
    const unsubscribe = subscribe(() => {
      if (pendingPlan) queueMicrotask(applyPendingIfIdle)
    })

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
    }
  }, [])
}

/** True while a refresh is in flight (for spinners). */
export function useSyncing(): boolean {
  return useSyncExternalStore(
    subscribeSyncing,
    () => inFlight !== null,
    () => false,
  )
}

/** Manual import of a scheda .json file (fallback when there is no endpoint). */
export async function importPlanFile(file: File): Promise<boolean> {
  const result = await readPlanFile(file)
  if (!result.ok) {
    toast(`${shortError(result.error)}\nLa scheda salvata non è cambiata.`, { tone: 'error', durationMs: 10_000 })
    return false
  }
  const current = getState().plan
  const older = current != null && isNewerPlan(current, result.plan)
  pendingPlan = null
  setPlan(result.plan, 'file')
  if (older) {
    toast(`Scheda importata: ${planLabel(result.plan)}. Attenzione: è più vecchia di quella che avevi.`, {
      tone: 'warn',
      durationMs: 8000,
    })
  } else {
    toast(`Scheda importata: ${planLabel(result.plan)}`, { tone: 'success', durationMs: 6000 })
  }
  return true
}

/** Loads the bundled example plan (scheda-corrente.json) — handy to try the app. */
export async function loadExamplePlan(): Promise<void> {
  let json: unknown
  try {
    const mod = await import('../../scheda-corrente.json')
    json = mod.default
  } catch {
    toast('Impossibile caricare la scheda di esempio: ricarica l’app e riprova.', { tone: 'error' })
    return
  }
  const parsed = parsePlan(json)
  if (!parsed.ok) {
    toast(shortError(parsed.error), { tone: 'error', durationMs: 10_000 })
    return
  }
  pendingPlan = null
  setPlan(parsed.plan, 'example')
  toast(`Scheda di esempio caricata: ${planLabel(parsed.plan)}`, { tone: 'success', durationMs: 6000 })
}
