import { useSyncExternalStore } from 'react'

/**
 * Persisted running timers (hold count-ups and countdowns) keyed by a stable id, so a timer
 * survives card collapse, tab switches, a locked screen and even a PWA reload.
 * All the math derives from Date.now() timestamps (nothing is ever decremented), so throttled
 * intervals or a sleeping device never make a timer drift.
 */

export const TIMERS_KEY = 'training:timers:v1'
/** Entries older than this are dropped on load (forgotten timers). */
export const TIMER_MAX_AGE_MS = 12 * 60 * 60 * 1000

export type TimerMode = 'countup' | 'countdown'
export type TimerPhase = 'prep' | 'run' | 'paused' | 'done'

export interface TimerState {
  mode: TimerMode
  label: string
  /** Stored phase. Use currentPhase() for the effective one (prep -> run, countdown at 0 -> done). */
  phase: TimerPhase
  createdAt: number
  /** End of the 3-2-1 preparation (count-up only); null without preparation. */
  prepEndsAt: number | null
  /** When counting starts (= prepEndsAt when there is a preparation). */
  runStartedAt: number | null
  /** Set while paused. */
  pausedAt: number | null
  /** Total length of the completed pauses. */
  pausedMs: number
  /** Countdown length; null for count-ups. */
  durationMs: number | null
  /** When the timer was marked done: the elapsed time is frozen there. */
  doneAt: number | null
}

export type TimerMap = Readonly<Record<string, TimerState>>

/* ───────────────────────── pure math ───────────────────────── */

export function createCountUp(label: string, prepSeconds: number, now: number): TimerState {
  const prepMs = Number.isFinite(prepSeconds) && prepSeconds > 0 ? Math.round(prepSeconds * 1000) : 0
  return {
    mode: 'countup',
    label,
    phase: prepMs > 0 ? 'prep' : 'run',
    createdAt: now,
    prepEndsAt: prepMs > 0 ? now + prepMs : null,
    runStartedAt: now + prepMs,
    pausedAt: null,
    pausedMs: 0,
    durationMs: null,
    doneAt: null,
  }
}

export function createCountdown(label: string, seconds: number, now: number): TimerState {
  const durationMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0
  return {
    mode: 'countdown',
    label,
    phase: 'run',
    createdAt: now,
    prepEndsAt: null,
    runStartedAt: now,
    pausedAt: null,
    pausedMs: 0,
    durationMs,
    doneAt: null,
  }
}

function runStart(t: TimerState): number {
  return t.runStartedAt ?? t.prepEndsAt ?? t.createdAt
}

/** Counted time (pauses excluded). 0 during the preparation; countdowns are capped at their length. */
export function elapsedMs(t: TimerState, now: number): number {
  const end = t.phase === 'paused' ? (t.pausedAt ?? now) : t.phase === 'done' ? (t.doneAt ?? now) : now
  const raw = Math.max(0, end - runStart(t) - t.pausedMs)
  return t.durationMs != null ? Math.min(raw, t.durationMs) : raw
}

/** Countdown: time left (>= 0). Count-up: Infinity. */
export function remainingMs(t: TimerState, now: number): number {
  if (t.durationMs == null) return Number.POSITIVE_INFINITY
  return Math.max(0, t.durationMs - elapsedMs(t, now))
}

/** Time left in the 3-2-1 preparation (0 once counting). */
export function prepRemainingMs(t: TimerState, now: number): number {
  if (t.phase !== 'prep' || t.prepEndsAt == null) return 0
  return Math.max(0, t.prepEndsAt - now)
}

/** Effective phase: prep turns into run when prepEndsAt passes, a countdown at 0 is done. */
export function currentPhase(t: TimerState, now: number): TimerPhase {
  let phase = t.phase
  if (phase === 'prep' && (t.prepEndsAt == null || now >= t.prepEndsAt)) phase = 'run'
  if (phase === 'run' && t.durationMs != null && remainingMs(t, now) <= 0) phase = 'done'
  return phase
}

/** Epoch ms when a running countdown reaches 0 (null for count-ups, paused or done timers). */
export function endsAt(t: TimerState): number | null {
  if (t.durationMs == null || (t.phase !== 'run' && t.phase !== 'prep')) return null
  return runStart(t) + t.pausedMs + t.durationMs
}

/** Pauses a counting timer (no-op during the preparation, while paused or after the end). */
export function pausedState(t: TimerState, now: number): TimerState {
  if (currentPhase(t, now) !== 'run') return t
  return { ...t, phase: 'paused', pausedAt: now }
}

export function resumedState(t: TimerState, now: number): TimerState {
  if (t.phase !== 'paused' || t.pausedAt == null) return t
  return { ...t, phase: 'run', pausedAt: null, pausedMs: t.pausedMs + Math.max(0, now - t.pausedAt) }
}

/** Freezes the timer: elapsed stops at `now` (or at the countdown end / pause if earlier). */
export function doneState(t: TimerState, now: number): TimerState {
  if (t.phase === 'done') return t
  if (t.phase === 'paused') return { ...t, phase: 'done', doneAt: t.pausedAt ?? now }
  const end = endsAt(t)
  return { ...t, phase: 'done', doneAt: end != null ? Math.min(now, end) : now }
}

/** Identity of one run of a timer id (a restart gets a new token). */
export function timerToken(id: string, t: TimerState): string {
  return `${id}@${t.createdAt}`
}

const MODES: readonly string[] = ['countup', 'countdown']
const PHASES: readonly string[] = ['prep', 'run', 'paused', 'done']

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v)

export function isTimerState(v: unknown): v is TimerState {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return (
    MODES.includes(t.mode as string) &&
    PHASES.includes(t.phase as string) &&
    typeof t.label === 'string' &&
    isNum(t.createdAt) &&
    isNumOrNull(t.prepEndsAt) &&
    isNumOrNull(t.runStartedAt) &&
    isNumOrNull(t.pausedAt) &&
    isNum(t.pausedMs) &&
    isNumOrNull(t.durationMs) &&
    (t.doneAt === undefined || isNumOrNull(t.doneAt))
  )
}

/** Keeps the well-formed entries created within TIMER_MAX_AGE_MS of `now`. */
export function pruneTimers(raw: unknown, now: number): Record<string, TimerState> {
  const out: Record<string, TimerState> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTimerState(v)) continue
    if (Math.abs(now - v.createdAt) > TIMER_MAX_AGE_MS) continue
    out[id] = { ...v, doneAt: v.doneAt ?? null }
  }
  return out
}

/* ───────────────────────── persisted store ───────────────────────── */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function load(now: number): TimerMap {
  const ls = storage()
  if (!ls) return {}
  try {
    const text = ls.getItem(TIMERS_KEY)
    return text ? pruneTimers(JSON.parse(text), now) : {}
  } catch {
    return {}
  }
}

let timers: TimerMap = load(Date.now())
const listeners = new Set<() => void>()

function persist(): void {
  const ls = storage()
  if (!ls) return
  try {
    if (Object.keys(timers).length === 0) ls.removeItem(TIMERS_KEY)
    else ls.setItem(TIMERS_KEY, JSON.stringify(timers))
  } catch {
    /* quota / private mode: timers keep working in memory */
  }
}

function emit(): void {
  for (const l of listeners) l()
}

function commit(next: TimerMap): void {
  if (next === timers) return
  timers = next
  persist()
  emit()
}

function update(id: string, fn: (t: TimerState) => TimerState): void {
  const t = timers[id]
  if (!t) return
  const next = fn(t)
  if (next !== t) commit({ ...timers, [id]: next })
}

/** A restart within the same millisecond still gets a distinct token. */
function freshStamp(id: string, now: number): number {
  const prev = timers[id]
  return prev && prev.createdAt >= now ? prev.createdAt + 1 : now
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Starts (or restarts) a count-up with an optional 3-2-1 preparation. */
export function startCountUp(id: string, label: string, prepSeconds: number, now = Date.now()): void {
  commit({ ...timers, [id]: createCountUp(label, prepSeconds, freshStamp(id, now)) })
}

/** Starts (or restarts) a countdown of `seconds`. */
export function startCountdown(id: string, label: string, seconds: number, now = Date.now()): void {
  commit({ ...timers, [id]: createCountdown(label, seconds, freshStamp(id, now)) })
}

export function pauseTimer(id: string, now = Date.now()): void {
  update(id, (t) => pausedState(t, now))
}

export function resumeTimer(id: string, now = Date.now()): void {
  update(id, (t) => resumedState(t, now))
}

export function markDone(id: string, now = Date.now()): void {
  update(id, (t) => doneState(t, now))
}

export function clearTimer(id: string): void {
  if (!(id in timers)) return
  const next: Record<string, TimerState> = { ...timers }
  delete next[id]
  commit(next)
}

export function getTimer(id: string): TimerState | null {
  return timers[id] ?? null
}

export function getAllTimers(): TimerMap {
  return timers
}

export function useTimer(id: string): TimerState | null {
  const get = () => timers[id] ?? null
  return useSyncExternalStore(subscribe, get, get)
}

export function useAllTimers(): TimerMap {
  return useSyncExternalStore(subscribe, getAllTimers, getAllTimers)
}

// Keep several open tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== TIMERS_KEY) return
    try {
      timers = e.newValue ? pruneTimers(JSON.parse(e.newValue), Date.now()) : {}
    } catch {
      return
    }
    emit()
  })
}

/* ───────────────────────── once-only side effects ───────────────────────── */

const claims = new Set<string>()

/**
 * True the first time `key` is claimed in this page session. Guards side effects (beeps,
 * onStop/onComplete) against StrictMode double effects, re-renders and remounts: key them by
 * timerToken() so every run of a timer has its own claims.
 */
export function claimOnce(key: string): boolean {
  if (claims.has(key)) return false
  claims.add(key)
  return true
}

/* ───────────────────────── mounted timer cards (ephemeral) ───────────────────────── */

let presence: Readonly<Record<string, boolean>> = {}
const presenceListeners = new Set<() => void>()

/**
 * Registers a mounted timer card: `visible` = on screen, false = mounted but scrolled away,
 * null = unmounted. The global watcher completes countdowns only for unmounted cards and shows
 * a chip for the ones that are not visible.
 */
export function setTimerPresence(id: string, visible: boolean | null): void {
  if (visible === null) {
    if (!(id in presence)) return
    const next: Record<string, boolean> = { ...presence }
    delete next[id]
    presence = next
  } else {
    if (presence[id] === visible) return
    presence = { ...presence, [id]: visible }
  }
  for (const l of presenceListeners) l()
}

function subscribePresence(listener: () => void): () => void {
  presenceListeners.add(listener)
  return () => presenceListeners.delete(listener)
}

function getPresence(): Readonly<Record<string, boolean>> {
  return presence
}

export function useTimerPresence(): Readonly<Record<string, boolean>> {
  return useSyncExternalStore(subscribePresence, getPresence, getPresence)
}

/** Test helper: empty store, claims and presence (does not touch localStorage). */
export function __resetTimersForTests(): void {
  timers = {}
  claims.clear()
  presence = {}
}
