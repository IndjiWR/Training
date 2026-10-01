import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tick } from '../../lib/feedback'
import { formatClock, formatRest, formatRestRange } from '../../lib/format'
import {
  claimOnce,
  clearTimer,
  currentPhase,
  remainingMs,
  timerToken,
  useAllTimers,
  useTimerPresence,
  type TimerMap,
} from '../../state/timers'
import { extendRest, getRestTimer, stopRest, useRestTimer, type RestTimer } from '../../state/ui'
import { IconClose } from '../icons'
import {
  ALERT_GRACE_MS,
  armAlarm,
  COUNTDOWN_ALARM_PREFIX,
  disarmAlarm,
  disarmAlarmsExcept,
  REST_ALARM_PREFIX,
  ringAlarm,
} from './alarms'
import { watchCountdowns } from './countdownResults'
import { useTicker } from './useTicker'
import './timers.css'

/** The "Recupero finito" state hides itself after this. */
const DONE_VISIBLE_MS = 8000
/** Remaining seconds shown in the warning colour. */
const FINAL_SECONDS = 10

interface Chip {
  id: string
  token: string
  label: string
  done: boolean
  leftS: number
  createdAt: number
}

function hasRunningCountdown(all: TimerMap): boolean {
  return Object.values(all).some((t) => t.mode === 'countdown' && t.phase === 'run')
}

/**
 * Global sticky rest bar (rendered once by the app shell above the bottom nav). Reads
 * useRestTimer(); shows label, big remaining time, planned range and "+30\"" when maxS != null,
 * "Salta". At the end: alertEnd() once, "Recupero finito" state, then hides.
 *
 * It is also the global watcher of persisted countdowns: it queues their end beeps, completes
 * the ones whose card is not mounted (alert + result recorded in the session + markDone) and
 * shows a chip for countdowns running off-screen ("⏱ Riscaldamento 7:32") or finished while
 * their card was closed.
 *
 * Its height is published as `--dock-h` on <html> so the shell can reserve room for it.
 */
export function RestTimerBar() {
  const rest = useRestTimer()
  const all = useAllTimers()
  const presence = useTimerPresence()
  const running = useMemo(() => hasRunningCountdown(all), [all])
  const now = useTicker(rest != null || running, 250)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const dockRef = useRef<HTMLDivElement>(null)

  // Countdown watcher: arm end beeps; complete (and record) the ended ones whose card is not mounted.
  useEffect(() => {
    const keep = watchCountdowns(all, presence, Date.now())
    disarmAlarmsExcept(COUNTDOWN_ALARM_PREFIX, keep)
  }, [all, presence, now])

  // Publish the dock height: chips and a wrapped panel can outgrow the room the shell reserves.
  useLayoutEffect(() => {
    const el = dockRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--dock-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--dock-h')
    }
  }, [])

  const chips = useMemo(() => {
    const list: Chip[] = []
    for (const [id, t] of Object.entries(all)) {
      if (t.mode !== 'countdown') continue
      const token = timerToken(id, t)
      const phase = currentPhase(t, now)
      if (phase === 'run' && presence[id] !== true) {
        list.push({ id, token, label: t.label, done: false, leftS: Math.ceil(remainingMs(t, now) / 1000), createdAt: t.createdAt })
      } else if (phase === 'done' && !(id in presence) && !dismissed.has(token)) {
        list.push({ id, token, label: t.label, done: true, leftS: 0, createdAt: t.createdAt })
      }
    }
    return list.sort((a, b) => a.createdAt - b.createdAt)
  }, [all, presence, now, dismissed])

  const dismiss = (token: string) => setDismissed((prev) => new Set(prev).add(token))

  const restDone = rest != null && now >= rest.endAt
  const doneLabels = chips.filter((c) => c.done).map((c) => c.label)
  const message = rest
    ? restDone
      ? 'Recupero finito — vai!'
      : `Recupero in corso — ${rest.label}`
    : doneLabels.length > 0
      ? `${doneLabels.join(', ')}: finito`
      : ''

  return (
    <div className="tm-dock" ref={dockRef}>
      <p className="visually-hidden" aria-live="polite">
        {message}
      </p>
      {chips.length > 0 && (
        <div className="tm-chips">
          {chips.map((c) =>
            c.done ? (
              <button
                key={c.token}
                type="button"
                className="tm-chip tm-chip--done"
                onClick={() => {
                  dismiss(c.token)
                  clearTimer(c.id)
                }}
                aria-label={`${c.label} finito. Chiudi avviso`}
              >
                <span aria-hidden="true">⏱</span>
                <span className="tm-chip__label">{c.label}</span>
                <span>finito</span>
                <IconClose />
              </button>
            ) : (
              <span key={c.token} className="tm-chip" data-final={c.leftS <= FINAL_SECONDS}>
                <span aria-hidden="true">⏱</span>
                <span className="tm-chip__label">{c.label}</span>
                <span className="num">{formatClock(c.leftS)}</span>
              </span>
            ),
          )}
        </div>
      )}
      {rest && <RestPanel key={rest.id} rest={rest} now={now} />}
    </div>
  )
}

function RestPanel({ rest, now }: { rest: RestTimer; now: number }) {
  const key = `${REST_ALARM_PREFIX}${rest.id}`
  const totalMs = Math.max(1, rest.endAt - rest.startedAt)
  const leftMs = Math.max(0, Math.min(totalMs, rest.endAt - now))
  const leftS = Math.ceil(leftMs / 1000)
  const finished = now >= rest.endAt

  // Queue the end beeps on the audio clock; "+30\"" moves endAt and re-queues them.
  useEffect(() => {
    if (!finished) armAlarm(key, rest.endAt)
  }, [key, rest.endAt, finished, now])

  // Skipped or replaced by a new rest: cancel the queued beeps.
  useEffect(() => () => disarmAlarm(key), [key])

  // Last 3 seconds: one tick per second.
  useEffect(() => {
    if (finished || leftS < 1 || leftS > 3) return
    if (claimOnce(`${key}@${rest.endAt}:t${leftS}`)) tick()
  }, [finished, leftS, key, rest.endAt])

  // End: vibrate + beep once (no second beep if the queued one already sounded).
  useEffect(() => {
    if (!finished || !claimOnce(`${key}@${rest.endAt}:end`)) return
    if (Date.now() - rest.endAt < ALERT_GRACE_MS) ringAlarm(key)
    else disarmAlarm(key)
  }, [finished, key, rest.endAt])

  // "Recupero finito" hides itself.
  useEffect(() => {
    if (!finished) return
    const h = setTimeout(() => {
      if (getRestTimer()?.id === rest.id) stopRest()
    }, DONE_VISIBLE_MS)
    return () => clearTimeout(h)
  }, [finished, rest.id])

  if (finished) {
    return (
      <button type="button" className="tm-rest tm-rest--done" onClick={() => stopRest()}>
        <span className="tm-rest__go">✓ Recupero finito — vai!</span>
        <span className="tm-rest__sub">
          {rest.label} · Tocca per chiudere
        </span>
      </button>
    )
  }

  return (
    <section className="tm-rest" aria-label="Recupero" data-final={leftS <= FINAL_SECONDS}>
      <div className="tm-rest__info">
        <span className="tm-rest__label">{rest.label}</span>
        <span className="tm-rest__range">
          Recupero {formatRestRange(rest.baseS, rest.maxS)}
          {rest.extraS > 0 && ` · +${formatRest(rest.extraS)}`}
        </span>
      </div>
      <span className="tm-rest__time num" role="timer">
        {formatClock(leftS)}
      </span>
      <div className="tm-rest__actions">
        {rest.maxS != null && (
          <button type="button" className="btn btn--outline" onClick={() => extendRest(30)} aria-label="+30 secondi">
            +30"
          </button>
        )}
        <button type="button" className="btn" onClick={() => stopRest()}>
          Salta
        </button>
      </div>
      <span className="tm-bar tm-rest__bar" aria-hidden="true">
        <span className="tm-bar__fill" style={{ width: `${(leftMs / totalMs) * 100}%` }} />
      </span>
    </section>
  )
}
