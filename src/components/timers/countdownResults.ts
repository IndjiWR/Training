import { applyElbow, sessionElbowLevel } from '../../lib/elbow'
import { rowCount } from '../../state/actions'
import { getState } from '../../state/store'
import { claimOnce, endsAt, markDone, timerToken, type TimerMap } from '../../state/timers'
import { complete, type Side } from '../exercise/tracker'
import { ALERT_GRACE_MS, armAlarm, countdownAlarmKey, disarmAlarm, ringAlarm } from './alarms'

/**
 * Countdowns that end while their card is not mounted (collapsed card, another tab): the global
 * watcher alerts, records the result in the session (as the card would) and marks them done.
 */

export interface TimerTarget {
  date: string
  index: number
  setIndex: number
  side: Side | null
}

/** Parses an exercise timer id `${date}#${index}#${set}` (+ `#dx` / `#sx`); null otherwise. */
export function parseTimerId(id: string): TimerTarget | null {
  const parts = id.split('#')
  if (parts.length !== 3 && parts.length !== 4) return null
  const [date, rawIndex, rawSet, rawSide] = parts
  if (!date || !/^\d+$/.test(rawIndex) || !/^\d+$/.test(rawSet)) return null
  const index = Number(rawIndex)
  const setIndex = Number(rawSet)
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(setIndex)) return null
  if (rawSide !== undefined && rawSide !== 'dx' && rawSide !== 'sx') return null
  return { date, index, setIndex, side: rawSide ?? null }
}

/**
 * Confirms the set/side behind a countdown id with `seconds`, exactly like the card's
 * onComplete: same rows/label, rest timer started when this completes the set. False when the
 * id or the plan day/exercise is unknown.
 */
export function recordCountdownResult(id: string, seconds: number): boolean {
  const target = parseTimerId(id)
  if (!target) return false
  const { plan, sessions } = getState()
  const day = plan?.days.find((d) => d.date === target.date)
  if (!plan || !day) return false
  const session = sessions[target.date]
  const eff = applyElbow(day, plan.library, sessionElbowLevel(session, plan.elbow))[target.index]
  if (!eff) return false
  const planned = eff.sets ?? 1
  const rows = Math.max(rowCount(session?.exercises[String(eff.index)], planned), planned)
  complete({ date: target.date, eff, rows }, target.setIndex, target.side, seconds, { tap: false })
  return true
}

/**
 * One pass of the global countdown watcher: queues the end beeps of running countdowns and
 * completes the ended ones whose card is not mounted (alert once, record once, mark done).
 * Returns the alarm keys still in use.
 */
export function watchCountdowns(
  all: TimerMap,
  presence: Readonly<Record<string, boolean>>,
  at: number,
): Set<string> {
  const keep = new Set<string>()
  for (const [id, t] of Object.entries(all)) {
    if (t.mode !== 'countdown' || t.phase !== 'run') continue
    const token = timerToken(id, t)
    const key = countdownAlarmKey(token)
    const end = endsAt(t)
    keep.add(key)
    if (end == null) continue
    if (end > at) {
      armAlarm(key, end)
      continue
    }
    if (id in presence) continue // the mounted card alerts and completes it
    if (claimOnce(`${token}:end`)) {
      if (at - end < ALERT_GRACE_MS) ringAlarm(key)
      else disarmAlarm(key)
    }
    try {
      // Same claim as the card's completion: the result is recorded once per run.
      if (claimOnce(`${token}:complete`)) recordCountdownResult(id, Math.round((t.durationMs ?? 0) / 1000))
    } finally {
      // Stored "done" tells the card (when it mounts again) that alert and result are handled.
      markDone(id, at)
    }
  }
  return keep
}
