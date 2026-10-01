import { useSyncExternalStore } from 'react'
import type { LibraryEntry } from '../../plan/schema'
import { useAppData } from '../../state/store'
import type { MediaPin } from '../../state/types'

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function onlineSnapshot(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

/** navigator.onLine, kept in sync with the online/offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true)
}

/** Pinned media of a library key (own properties only: keys like "constructor" are safe). */
export function usePin(key: string): MediaPin | undefined {
  return useAppData((s) => (Object.hasOwn(s.pins, key) ? s.pins[key] : undefined))
}

/** Library entry of the current plan, undefined without plan or for unknown keys. */
export function useLibraryEntry(key: string): LibraryEntry | undefined {
  return useAppData((s) => (s.plan && Object.hasOwn(s.plan.library, key) ? s.plan.library[key] : undefined))
}

/** Same as navigator.onLine, for event handlers. */
export function isOnline(): boolean {
  return onlineSnapshot()
}
