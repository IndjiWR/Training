import { useSyncExternalStore } from 'react'
import { parsePlan } from '../plan/schema'
import type { AppData, DataSync, Settings } from './types'

/**
 * Single persisted store (localStorage). Updates are immutable: always return a new
 * object for every level you change, so `useAppData` selectors stay referentially stable.
 */

export const STORAGE_KEY = 'training:data:v1'
const CORRUPT_KEY = 'training:data:corrupt'

export const DEFAULT_SETTINGS: Settings = {
  endpoint: '',
  token: '',
  theme: 'dark',
  sound: true,
  vibration: true,
}

/**
 * Not synced with any Drive file: the next sync downloads everything and merges every local record
 * with it (nothing overwritten). `generation` continues from the previous state.
 */
export function defaultSync(enabled = true, generation = 0): DataSync {
  return {
    enabled,
    epoch: null,
    rev: 0,
    uploadAll: true,
    pending: { sessions: {}, days: {}, pins: {} },
    base: { sessions: {}, days: {}, pins: {} },
    sent: { sessions: {}, days: {}, pins: {} },
    refetch: false,
    generation,
    unreadable: { sessions: [], days: [], pins: [] },
    unreadableBuild: null,
    lastSyncAt: null,
    lastError: null,
  }
}

export function defaultData(): AppData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    plan: null,
    planMeta: { source: null, receivedAt: null, lastCheckAt: null, lastError: null },
    sessions: {},
    days: {},
    pins: {},
    sync: defaultSync(),
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Stored sync state with defaults for anything missing or malformed (data saved before sync existed). */
function normalizeSync(raw: unknown): DataSync {
  const fresh = defaultSync()
  if (!isRecord(raw)) return fresh
  const pending = isRecord(raw.pending) ? raw.pending : {}
  const base = isRecord(raw.base) ? raw.base : {}
  const sent = isRecord(raw.sent) ? raw.sent : {}
  const unreadable = isRecord(raw.unreadable) ? raw.unreadable : {}
  const marks = (v: unknown): Record<string, number> =>
    isRecord(v)
      ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'))
      : {}
  const bases = (v: unknown): Record<string, unknown> => (isRecord(v) ? { ...v } : {})
  const keys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [])
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fresh.enabled,
    epoch: typeof raw.epoch === 'string' ? raw.epoch : null,
    rev: finite(raw.rev, 0),
    uploadAll: typeof raw.uploadAll === 'boolean' ? raw.uploadAll : fresh.uploadAll,
    pending: { sessions: marks(pending.sessions), days: marks(pending.days), pins: marks(pending.pins) },
    base: { sessions: bases(base.sessions), days: bases(base.days), pins: bases(base.pins) },
    sent: { sessions: bases(sent.sessions), days: bases(sent.days), pins: bases(sent.pins) },
    refetch: raw.refetch === true,
    generation: finite(raw.generation, 0),
    unreadable: { sessions: keys(unreadable.sessions), days: keys(unreadable.days), pins: keys(unreadable.pins) },
    unreadableBuild: typeof raw.unreadableBuild === 'string' ? raw.unreadableBuild : null,
    lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Fills missing fields of a stored/imported object with defaults; re-validates the plan. */
export function normalizeData(raw: unknown): AppData {
  const base = defaultData()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AppData>
  const data: AppData = {
    version: 1,
    settings: { ...base.settings, ...(r.settings ?? {}) },
    plan: null,
    planMeta: { ...base.planMeta, ...(r.planMeta ?? {}) },
    sessions: r.sessions && typeof r.sessions === 'object' ? r.sessions : {},
    days: r.days && typeof r.days === 'object' ? r.days : {},
    pins: r.pins && typeof r.pins === 'object' ? r.pins : {},
    sync: normalizeSync(r.sync),
  }
  if (r.plan) {
    const parsed = parsePlan(r.plan)
    if (parsed.ok) data.plan = parsed.plan
    else data.planMeta = { ...data.planMeta, lastError: parsed.error }
  }
  return data
}

function load(): AppData {
  const ls = storage()
  if (!ls) return defaultData()
  const text = ls.getItem(STORAGE_KEY)
  if (!text) return defaultData()
  try {
    return normalizeData(JSON.parse(text))
  } catch {
    // Keep the unreadable payload aside instead of silently losing it.
    try {
      ls.setItem(CORRUPT_KEY, text)
    } catch {
      /* ignore */
    }
    return defaultData()
  }
}

let state: AppData = load()
let persistFailed = false
// Storage blocked by the browser (cookies/site data disabled): nothing will survive a reload.
const storageUnavailable = typeof window !== 'undefined' && storage() === null
const listeners = new Set<() => void>()

function persist(next: AppData): void {
  const ls = storage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(next))
    persistFailed = false
  } catch {
    persistFailed = true
  }
}

function emit(): void {
  for (const l of listeners) l()
}

export function getState(): AppData {
  return state
}

/**
 * True when the last write to localStorage failed (quota, private mode…) or when localStorage
 * is not available at all (site data blocked by the browser): data lives in memory only.
 */
export function lastPersistFailed(): boolean {
  return persistFailed || storageUnavailable
}

export function setState(updater: (s: AppData) => AppData): void {
  const next = updater(state)
  if (next === state) return
  state = next
  persist(state)
  emit()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Subscribe a component to a slice of the store. The selector must return a value that is
 * already in the state (or a primitive): never build new objects/arrays inside it.
 */
export function useAppData<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  )
}

// Keep several open tabs/windows in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || e.newValue == null) return
    try {
      state = normalizeData(JSON.parse(e.newValue))
      emit()
    } catch {
      /* ignore */
    }
  })
}

/** Test helper: replace the in-memory state without touching listeners' expectations. */
export function __setStateForTests(next: AppData): void {
  state = next
}
