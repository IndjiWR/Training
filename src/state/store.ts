import { useSyncExternalStore } from 'react'
import { parsePlan } from '../plan/schema'
import type { AppData, Settings } from './types'

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

export function defaultData(): AppData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    plan: null,
    planMeta: { source: null, receivedAt: null, lastCheckAt: null, lastError: null },
    sessions: {},
    days: {},
    pins: {},
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
