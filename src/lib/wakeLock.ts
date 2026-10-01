import { useEffect, useState, useSyncExternalStore } from 'react'

function isSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock != null
  } catch {
    return false
  }
}

/* ───────────── shared screen lock (one sentinel for every owner) ───────────── */

/** Owners currently asking to keep the screen on (app shell, Oggi screen…). */
let claims = 0
let sentinel: WakeLockSentinel | null = null
let pending = false
let locked = false
const listeners = new Set<() => void>()

function setLocked(next: boolean): void {
  if (locked === next) return
  locked = next
  for (const l of listeners) l()
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

async function acquire(): Promise<void> {
  if (claims === 0 || pending || (sentinel && !sentinel.released) || !pageVisible()) return
  pending = true
  try {
    const s = await navigator.wakeLock.request('screen')
    if (claims === 0) {
      await s.release().catch(() => {})
      return
    }
    sentinel = s
    // The browser releases the lock by itself (page hidden, battery saver…): track it.
    s.addEventListener('release', () => {
      if (sentinel !== s) return
      sentinel = null
      setLocked(false)
    })
    setLocked(!s.released)
  } catch {
    // NotAllowedError (no user activation, battery saver, permissions policy…).
    setLocked(false)
  } finally {
    pending = false
  }
}

function onVisibility(): void {
  if (pageVisible()) void acquire()
}

/**
 * Asks to keep the screen on until the returned function is called. Claims are counted: one
 * sentinel is held while at least one claim is open, and it is re-acquired when the page becomes
 * visible again (the browser releases it on tab switch/screen off). No-op when unsupported.
 */
export function claimWakeLock(): () => void {
  if (!isSupported()) return () => {}
  let open = true
  claims += 1
  if (claims === 1 && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  void acquire()
  return () => {
    if (!open) return
    open = false
    claims -= 1
    if (claims > 0) return
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    const s = sentinel
    sentinel = null
    if (s) s.release().catch(() => {})
    setLocked(false)
  }
}

/** True while the shared screen lock is actually held (whoever claimed it). */
export function isWakeLocked(): boolean {
  return locked
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive isWakeLocked(): lets a screen show "Schermo sempre acceso" without owning the lock. */
export function useWakeLocked(): boolean {
  return useSyncExternalStore(subscribe, isWakeLocked, () => false)
}

/**
 * Keeps the screen on while `active` (Screen Wake Lock API). Several components may call it at
 * once (e.g. the app shell during a workout and the Oggi screen): they share one lock, held while
 * any of them is active. Released on unmount or when `active` turns false. `locked` is true while
 * this hook is active and the shared lock is held. No-op when unsupported.
 */
export function useWakeLock(active: boolean): { supported: boolean; locked: boolean } {
  const [supported] = useState(isSupported)
  const held = useWakeLocked()

  useEffect(() => {
    if (!active || !supported) return
    return claimWakeLock()
  }, [active, supported])

  return { supported, locked: supported && active && held }
}
