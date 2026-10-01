import { useEffect, useMemo, useState } from 'react'
import { ACTIVE_SESSION_MS, openSessionStart } from '../../state/planSync'
import { useAppData } from '../../state/store'
import { useAllTimers } from '../../state/timers'
import { useRestTimer } from '../../state/ui'
import { workoutActiveUntil } from './dayUtils'

/**
 * True while a workout is in progress anywhere in the app, whatever day is shown: an open session
 * started less than ACTIVE_SESSION_MS ago (same rule as the plan sync), the rest timer, or a running
 * exercise timer (e.g. the warm-up countdown started before "Inizia sessione"). Drives the screen
 * wake lock. Re-evaluates by itself when the last of them expires.
 */
export function useWorkoutActive(): boolean {
  const openStart = useAppData((s) => openSessionStart(s.sessions))
  const rest = useRestTimer()
  const timers = useAllTimers()
  // Reference time, refreshed when the current "until" passes (stores re-render on any change).
  const [now, setNow] = useState(() => Date.now())

  const until = useMemo(
    () => workoutActiveUntil({ openSessionStart: openStart, restEndAt: rest?.endAt ?? null, timers }, now, ACTIVE_SESSION_MS),
    [openStart, rest, timers, now],
  )

  useEffect(() => {
    if (until == null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()) + 250)
    return () => clearTimeout(timer)
  }, [until])

  return until != null
}
