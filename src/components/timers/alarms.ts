import { alertEnd, scheduleAlertAt, type ScheduledAlert } from '../../lib/feedback'

/**
 * End alarms queued on the audio clock, keyed by timer (so the card, the global watcher and
 * the rest bar share them). The beeps sound on time even with throttled JS; whoever notices the
 * end calls ringAlarm(): it vibrates, and beeps only if the queued beeps did not play.
 */

/** Ends noticed later than this (app reopened long after) are completed silently. */
export const ALERT_GRACE_MS = 60_000

export const REST_ALARM_PREFIX = 'rest:'
export const COUNTDOWN_ALARM_PREFIX = 'cd:'

export function countdownAlarmKey(token: string): string {
  return `${COUNTDOWN_ALARM_PREFIX}${token}`
}

interface Armed {
  at: number
  handle: ScheduledAlert
}

const armed = new Map<string, Armed>()

/**
 * Queues the end beeps for `at` (epoch ms). Idempotent for the same key and time; a new time
 * (e.g. +30") replaces the old beeps. Cheap to call on every tick: if audio was not unlocked
 * yet, the next call retries.
 */
export function armAlarm(key: string, at: number): void {
  const cur = armed.get(key)
  if (cur && cur.at === at && cur.handle.scheduled) return
  if (cur) {
    cur.handle()
    armed.delete(key)
  }
  if (at - Date.now() < 100) return
  const handle = scheduleAlertAt(at)
  armed.set(key, { at, handle })
}

/** Cancels the queued beeps (pause, skip, reset). */
export function disarmAlarm(key: string): void {
  const cur = armed.get(key)
  if (!cur) return
  cur.handle()
  armed.delete(key)
}

/** The end was reached: vibrate, and beep unless the queued beeps already sounded. */
export function ringAlarm(key: string): void {
  const cur = armed.get(key)
  armed.delete(key)
  alertEnd(cur?.handle)
}

/** Cancels every alarm whose key starts with `prefix` and is not in `keep`. */
export function disarmAlarmsExcept(prefix: string, keep: ReadonlySet<string>): void {
  for (const key of [...armed.keys()]) {
    if (key.startsWith(prefix) && !keep.has(key)) disarmAlarm(key)
  }
}
