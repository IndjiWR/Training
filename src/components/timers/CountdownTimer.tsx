import { useEffect, useRef, useState } from 'react'
import { confirmTap, tick, unlockAudio } from '../../lib/feedback'
import { formatClock } from '../../lib/format'
import {
  claimOnce,
  clearTimer,
  currentPhase,
  elapsedMs,
  endsAt,
  getTimer,
  pauseTimer,
  remainingMs,
  resumeTimer,
  setTimerPresence,
  startCountdown,
  timerToken,
  useTimer,
} from '../../state/timers'
import { IconCheck, IconPause, IconPlay, IconReset } from '../icons'
import { ALERT_GRACE_MS, armAlarm, countdownAlarmKey, disarmAlarm, ringAlarm } from './alarms'
import { useTicker } from './useTicker'
import './timers.css'

export interface CountdownTimerProps {
  /** Stable id: the running countdown survives unmount/navigation and reloads. */
  id: string
  /** Total seconds. */
  seconds: number
  /** Called once when the countdown reaches 0 (beep + vibration fire too) or the user taps "Fatto" early: elapsed seconds. */
  onComplete: (elapsedSeconds: number) => void
  label: string
  disabled?: boolean
}

/** "Azzera" needs a second tap within this time. */
const RESET_CONFIRM_MS = 4000

type ViewState = 'idle' | 'running' | 'paused' | 'done'

/**
 * time: countdown with start / pause / resume / reset; beep + vibrate at the end.
 * The run is persisted (src/state/timers.ts): when the card is not mounted the global watcher
 * (RestTimerBar) alerts at the end and marks it done; the result is handed to onComplete as soon
 * as the card mounts again. `disabled` only blocks starting.
 */
export function CountdownTimer({ id, seconds, onComplete, label, disabled = false }: CountdownTimerProps) {
  const stored = useTimer(id)
  const timer = stored?.mode === 'countdown' ? stored : null
  const now = useTicker(timer?.phase === 'run', 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  const phase = timer ? currentPhase(timer, now) : null
  const token = timer ? timerToken(id, timer) : null
  const alarmKey = token ? countdownAlarmKey(token) : null
  const endAt = timer ? endsAt(timer) : null
  const totalMs = timer?.durationMs ?? Math.max(0, Math.round(seconds * 1000))
  const leftMs = timer ? remainingMs(timer, now) : totalMs
  const leftS = Math.ceil(leftMs / 1000)
  const view: ViewState = !timer ? 'idle' : phase === 'done' ? 'done' : phase === 'paused' ? 'paused' : 'running'

  // Tell the global watcher this card is mounted, and whether it is on screen.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setTimerPresence(id, true)
      return () => setTimerPresence(id, null)
    }
    setTimerPresence(id, false)
    // The bottom quarter is covered by the rest bar and the nav.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setTimerPresence(id, e.isIntersecting)
      },
      { rootMargin: '0px 0px -25% 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      setTimerPresence(id, null)
    }
  }, [id])

  // Queue the end beeps on the audio clock (re-armed after a resume; retried until audio is unlocked).
  useEffect(() => {
    if (alarmKey && endAt != null && endAt > Date.now()) armAlarm(alarmKey, endAt)
  }, [alarmKey, endAt, now])

  // Last 3 seconds: one tick per second.
  useEffect(() => {
    if (view !== 'running' || !token || endAt == null || leftS < 1 || leftS > 3) return
    if (claimOnce(`${token}@${endAt}:t${leftS}`)) tick()
  }, [view, token, endAt, leftS])

  // End reached (here, or while unmounted): alert once, report the full duration once, clear.
  useEffect(() => {
    if (!timer || !token || phase !== 'done') return
    if (!claimOnce(`${token}:complete`)) return
    const key = countdownAlarmKey(token)
    const end = endsAt(timer)
    // Stored phase "done" = the watcher already alerted while the card was not mounted.
    if (timer.phase !== 'done' && claimOnce(`${token}:end`) && (end == null || Date.now() - end < ALERT_GRACE_MS)) {
      ringAlarm(key)
    } else {
      disarmAlarm(key)
    }
    try {
      onCompleteRef.current(Math.round((timer.durationMs ?? 0) / 1000))
    } finally {
      clearTimer(id)
    }
  }, [timer, token, phase, id])

  // Drop the "Azzera" confirmation after a while.
  useEffect(() => {
    if (!confirmReset) return
    const h = setTimeout(() => setConfirmReset(false), RESET_CONFIRM_MS)
    return () => clearTimeout(h)
  }, [confirmReset])

  const start = () => {
    if (disabled || !(seconds > 0)) return
    unlockAudio()
    confirmTap()
    startCountdown(id, label, seconds)
  }

  const pause = () => {
    if (alarmKey) disarmAlarm(alarmKey)
    pauseTimer(id)
  }

  const resume = () => {
    unlockAudio()
    setConfirmReset(false)
    resumeTimer(id)
  }

  const finishEarly = () => {
    const cur = getTimer(id)
    if (!cur || cur.mode !== 'countdown') return
    const tok = timerToken(id, cur)
    if (!claimOnce(`${tok}:complete`)) return
    claimOnce(`${tok}:end`)
    disarmAlarm(countdownAlarmKey(tok))
    const elapsed = Math.floor(elapsedMs(cur, Date.now()) / 1000)
    confirmTap()
    try {
      onCompleteRef.current(elapsed)
    } finally {
      clearTimer(id)
    }
  }

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setConfirmReset(false)
    if (alarmKey) disarmAlarm(alarmKey)
    clearTimer(id)
  }

  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, 1 - leftMs / totalMs)) : 0
  const announce = view === 'paused' ? 'In pausa' : view === 'done' ? `${label}: finito` : view === 'running' ? 'In corso' : ''

  return (
    <div className="tm-cd" data-state={view} ref={rootRef}>
      {view === 'idle' ? (
        <>
          <div className="tm-cd__idle">
            <span className="tm-cd__total num">{formatClock(seconds)}</span>
            <span className="tm-cd__name">{label}</span>
          </div>
          <button
            type="button"
            className="btn btn--primary btn--big btn--block"
            disabled={disabled || !(seconds > 0)}
            onClick={start}
          >
            <IconPlay />
            Avvia
          </button>
        </>
      ) : (
        <>
          <div className="tm-cd__display" role="timer" aria-label={`${label}: tempo rimanente`}>
            <span className="tm-stage__label">
              {label}
              {view === 'paused' && <span className="badge">In pausa</span>}
              {view === 'done' && <span className="badge badge--ok">Finito</span>}
            </span>
            <span className="bignum tm-cd__time" data-final={view === 'running' && leftS <= 10}>
              {formatClock(leftS)}
            </span>
            <span className="tm-bar" aria-hidden="true">
              <span className="tm-bar__fill" style={{ width: `${fraction * 100}%` }} />
            </span>
            <span className="tm-cd__of num">di {formatClock(totalMs / 1000)}</span>
          </div>

          {view === 'running' && (
            <div className="tm-actions">
              <button type="button" className="btn btn--outline btn--big" onClick={pause}>
                <IconPause />
                Pausa
              </button>
              <button type="button" className="btn btn--ok btn--big" onClick={finishEarly}>
                <IconCheck />
                Fatto
              </button>
            </div>
          )}

          {view === 'paused' && (
            <>
              <button type="button" className="btn btn--primary btn--big btn--block" onClick={resume}>
                <IconPlay />
                Riprendi
              </button>
              <div className="tm-actions">
                <button
                  type="button"
                  className={confirmReset ? 'btn btn--danger' : 'btn btn--outline'}
                  onClick={reset}
                >
                  <IconReset />
                  {confirmReset ? 'Conferma azzera' : 'Azzera'}
                </button>
                <button type="button" className="btn btn--outline" onClick={finishEarly}>
                  <IconCheck />
                  Fatto
                </button>
              </div>
            </>
          )}
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}
