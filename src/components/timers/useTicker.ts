import { useEffect, useState } from 'react'

/**
 * Current time (Date.now()) that re-renders the component every `intervalMs` while `active`,
 * and immediately when the page becomes visible again (intervals are throttled in background).
 * Timers derive everything from timestamps, so the interval only drives the display.
 */
export function useTicker(active: boolean, intervalMs = 200): number {
  const [tickState, setTickState] = useState(() => ({ now: Date.now(), active }))

  // Turning active: refresh during render, so the first frame never shows a stale time.
  let now = tickState.now
  if (tickState.active !== active) {
    now = Date.now()
    setTickState({ now, active })
  }

  useEffect(() => {
    if (!active) return
    const update = () => setTickState({ now: Date.now(), active: true })
    const onVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    update()
    const handle = setInterval(update, Math.max(16, intervalMs))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', update)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(handle)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', update)
      window.removeEventListener('focus', update)
    }
  }, [active, intervalMs])

  return now
}
