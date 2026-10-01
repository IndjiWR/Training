import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Plan } from '../../plan/schema'
import { pickDefaultDay, todayISO, type DayPickReason } from '../../lib/date'
import { useAppData } from '../../state/store'
import { sessionRunning } from './dayUtils'

/**
 * Selected day of the "Oggi" screen. The default is today's day (Europe/Rome) or the next one;
 * a manual choice lives in sessionStorage (one key per plan id) so switching tabs keeps it.
 * A choice made on a previous calendar day is ignored, so reopening the app the next morning
 * shows the new day. Exception: when midnight passes while the shown day's session is running
 * (started less than CARRY_MS ago, not finished), that day stays shown.
 */

const KEY_PREFIX = 'training:oggi:day:'
/** A session started at most this long before midnight keeps its day on screen past midnight. */
const CARRY_MS = 6 * 3_600_000

interface StoredChoice {
  /** Selected day date. */
  date: string
  /** Today's date when the choice was made. */
  on: string
}

function readChoice(key: string): StoredChoice | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === 'object') {
      const { date, on } = v as Record<string, unknown>
      if (typeof date === 'string' && typeof on === 'string') return { date, on }
    }
  } catch {
    /* unavailable or corrupt: fall back to the default day */
  }
  return null
}

function writeChoice(key: string, choice: StoredChoice | null): void {
  try {
    if (choice) sessionStorage.setItem(key, JSON.stringify(choice))
    else sessionStorage.removeItem(key)
  } catch {
    /* ignore (private mode, quota) */
  }
}

/** Today's ISO date in Europe/Rome, refreshed every minute and when the app returns to the foreground. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO())
  useEffect(() => {
    const update = () => setToday(todayISO())
    const onVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    const timer = setInterval(update, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', update)
    }
  }, [])
  return today
}

export interface DaySelection {
  /** Index of the selected day in plan.days. */
  index: number
  /** Today's date (Europe/Rome). */
  today: string
  /** Index of the default day and why it was picked. */
  defaultIndex: number
  reason: DayPickReason
  select: (index: number) => void
}

export function useSelectedDay(plan: Plan): DaySelection {
  const today = useToday()
  const key = KEY_PREFIX + plan.id
  const sessions = useAppData((s) => s.sessions)
  const pick = useMemo(
    () => pickDefaultDay(plan.days, today) ?? { index: 0, reason: 'past' as DayPickReason },
    [plan.days, today],
  )

  const [state, setState] = useState<{ key: string; choice: StoredChoice | null }>(() => ({
    key,
    choice: readChoice(key),
  }))
  // New plan id -> its own (normally empty) choice: the selection resets to the default day.
  const choice = state.key === key ? state.choice : readChoice(key)

  let index = pick.index
  if (choice && choice.on === today) {
    const i = plan.days.findIndex((d) => d.date === choice.date)
    if (i >= 0) index = i
  }

  // Midnight during a running session: keep the shown day by turning it into a choice made on the
  // new day (adjusting state during render, so the new day never flashes). Only for a recent start:
  // reopening the app the next morning still shows the new day.
  const shownDate = plan.days[index]?.date ?? ''
  const [last, setLast] = useState({ today, date: shownDate })
  if (last.today !== today) {
    const running = sessionRunning(sessions[last.date], Date.now(), CARRY_MS)
    const i = running ? plan.days.findIndex((d) => d.date === last.date) : -1
    if (i >= 0 && i !== index) {
      const next = { date: last.date, on: today }
      writeChoice(key, next)
      setState({ key, choice: next })
      index = i
    }
    setLast({ today, date: plan.days[index]?.date ?? '' })
  } else if (last.date !== shownDate) {
    setLast({ today, date: shownDate })
  }

  const select = useCallback(
    (i: number) => {
      const day = plan.days[i]
      if (!day) return
      // Picking the default day again clears the choice, so it keeps following "today".
      const next = i === pick.index ? null : { date: day.date, on: today }
      writeChoice(key, next)
      setState({ key, choice: next })
    },
    [plan.days, pick.index, today, key],
  )

  return { index, today, defaultIndex: pick.index, reason: pick.reason, select }
}
