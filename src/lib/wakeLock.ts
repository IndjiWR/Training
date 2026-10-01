import { useEffect, useState } from 'react'

function isSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock != null
  } catch {
    return false
  }
}

/**
 * Keeps the screen on while `active` (Screen Wake Lock API). Re-acquires the lock when the page
 * becomes visible again (the browser releases it on tab switch/screen off). Releases on
 * unmount or when `active` turns false. No-op when unsupported.
 */
export function useWakeLock(active: boolean): { supported: boolean; locked: boolean } {
  const [supported] = useState(isSupported)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    if (!active || !supported) return
    let disposed = false
    let pending = false
    let sentinel: WakeLockSentinel | null = null

    // The browser releases the lock by itself (page hidden, battery saver…): track it.
    const onRelease = () => {
      sentinel = null
      if (!disposed) setLocked(false)
    }

    const acquire = async () => {
      if (disposed || pending || (sentinel && !sentinel.released)) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      pending = true
      try {
        const s = await navigator.wakeLock.request('screen')
        if (disposed) {
          await s.release().catch(() => {})
          return
        }
        sentinel = s
        s.addEventListener('release', onRelease)
        setLocked(!s.released)
      } catch {
        // NotAllowedError (no user activation, battery saver, permissions policy…).
        if (!disposed) setLocked(false)
      } finally {
        pending = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      const s = sentinel
      sentinel = null
      if (s) {
        s.removeEventListener('release', onRelease)
        s.release().catch(() => {})
      }
      setLocked(false)
    }
  }, [active, supported])

  return { supported, locked: supported && active && locked }
}
