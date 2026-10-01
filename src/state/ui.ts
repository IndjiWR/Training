import { useSyncExternalStore } from 'react'

/**
 * Ephemeral (non-persisted) UI state: toasts and the rest timer.
 * Timers are timestamp based (endAt), so throttled intervals or a locked screen never drift.
 */

export type ToastTone = 'info' | 'success' | 'warn' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  action?: { label: string; run: () => void }
  /** Auto-dismiss after ms; 0 = sticky until dismissed. */
  durationMs: number
}

export interface RestTimer {
  id: number
  label: string
  startedAt: number
  /** Epoch ms when the rest ends (includes extensions). */
  endAt: number
  baseS: number
  /** Upper bound of the planned range (rest_max_s) when larger than baseS, else null. */
  maxS: number | null
  /** Seconds added with "+30\"". */
  extraS: number
}

interface UiState {
  toasts: Toast[]
  rest: RestTimer | null
}

let ui: UiState = { toasts: [], rest: null }
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function set(next: UiState): void {
  ui = next
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function toast(
  message: string,
  opts: { tone?: ToastTone; durationMs?: number; action?: Toast['action'] } = {},
): number {
  const id = nextId++
  const t: Toast = {
    id,
    message,
    tone: opts.tone ?? 'info',
    action: opts.action,
    durationMs: opts.durationMs ?? (opts.tone === 'error' ? 8000 : 4000),
  }
  set({ ...ui, toasts: [...ui.toasts, t].slice(-4) })
  if (t.durationMs > 0) timers.set(id, setTimeout(() => dismissToast(id), t.durationMs))
  return id
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  if (!ui.toasts.some((t) => t.id === id)) return
  set({ ...ui, toasts: ui.toasts.filter((t) => t.id !== id) })
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => ui.toasts, () => ui.toasts)
}

/** Starts (or restarts) the rest timer. Ignored when seconds <= 0. */
export function startRest(opts: { seconds: number; maxSeconds?: number | null; label: string }): void {
  if (!(opts.seconds > 0)) return
  const now = Date.now()
  const maxS = opts.maxSeconds != null && opts.maxSeconds > opts.seconds ? opts.maxSeconds : null
  set({
    ...ui,
    rest: {
      id: nextId++,
      label: opts.label,
      startedAt: now,
      endAt: now + opts.seconds * 1000,
      baseS: opts.seconds,
      maxS,
      extraS: 0,
    },
  })
}

/** Adds seconds to the running rest (default +30"). */
export function extendRest(seconds = 30): void {
  if (!ui.rest) return
  const base = Math.max(ui.rest.endAt, Date.now())
  set({ ...ui, rest: { ...ui.rest, endAt: base + seconds * 1000, extraS: ui.rest.extraS + seconds } })
}

export function stopRest(): void {
  if (!ui.rest) return
  set({ ...ui, rest: null })
}

export function useRestTimer(): RestTimer | null {
  return useSyncExternalStore(subscribe, () => ui.rest, () => ui.rest)
}

export function getRestTimer(): RestTimer | null {
  return ui.rest
}
