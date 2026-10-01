import { useEffect, useRef } from 'react'
import { alertEnd, confirmTap, goBeep, tick, unlockAudio } from '../../lib/feedback'
import {
  claimOnce,
  clearTimer,
  currentPhase,
  elapsedMs,
  getTimer,
  prepRemainingMs,
  startCountUp,
  timerToken,
  useTimer,
} from '../../state/timers'
import { IconClose, IconPlay, IconStop } from '../icons'
import { useTicker } from './useTicker'
import './timers.css'

export interface HoldTimerProps {
  /** Stable id (e.g. `${date}#${exIndex}#${setIndex}` or with `#dx`/`#sx`): the running timer survives unmount/navigation. */
  id: string
  /** Target band in seconds, highlighted while counting up (null = plain stopwatch). */
  targetMin: number | null
  targetMax: number | null
  /** Seconds of 3-2-1 before counting (default 3, 0 = start immediately). */
  prepSeconds?: number
  /** Called once when the user taps to stop: whole seconds held. */
  onStop: (seconds: number) => void
  /** Called when the user starts the timer ("Via"). */
  onStart?: () => void
  /** Accessible label, e.g. "Serie 2". */
  label: string
  disabled?: boolean
}

/** Cues (go, band entry, max) fire only this close to their moment: no stale beeps after a remount. */
const CUE_WINDOW_MS = 1200

interface Band {
  lo: number
  /** null = open-ended ("at least lo"). */
  hi: number | null
}

type Zone = 'free' | 'below' | 'in' | 'over'

function bandOf(min: number | null, max: number | null): Band | null {
  if (min != null && max != null) return { lo: Math.min(min, max), hi: Math.max(min, max) }
  if (min != null) return { lo: min, hi: null }
  if (max != null) return { lo: max, hi: max }
  return null
}

function zoneOf(seconds: number, band: Band | null): Zone {
  if (!band) return 'free'
  if (seconds < band.lo) return 'below'
  if (band.hi != null && seconds > band.hi) return 'over'
  return 'in'
}

function bandText(band: Band): string {
  if (band.hi == null) return `almeno ${band.lo} s`
  return band.hi === band.lo ? `${band.lo} s` : `${band.lo}–${band.hi} s`
}

const STATUS: Record<Zone, string> = {
  free: 'Cronometro',
  below: '',
  in: '✓ Nel range',
  over: '▲ Oltre il massimo',
}

/**
 * hold: "Via" -> 3-2-1 -> count-up with target band highlighted -> tap to stop and save seconds.
 * The run is persisted (src/state/timers.ts): it keeps counting if the card is collapsed, the
 * screen locks or the app reloads, and resumes on mount. `disabled` only blocks starting: a run
 * already in progress can still be stopped or cancelled.
 */
export function HoldTimer({
  id,
  targetMin,
  targetMax,
  prepSeconds,
  onStop,
  onStart,
  label,
  disabled = false,
}: HoldTimerProps) {
  const stored = useTimer(id)
  const timer = stored?.mode === 'countup' ? stored : null
  const live = timer != null && (timer.phase === 'prep' || timer.phase === 'run')
  const now = useTicker(live, 100)

  const onStopRef = useRef(onStop)
  useEffect(() => {
    onStopRef.current = onStop
  })

  const band = bandOf(targetMin, targetMax)
  const phase = timer ? currentPhase(timer, now) : null
  const token = timer ? timerToken(id, timer) : ''
  const ms = timer ? elapsedMs(timer, now) : 0
  const seconds = Math.floor(ms / 1000)
  const prepLeft = timer && phase === 'prep' ? prepRemainingMs(timer, now) : 0
  const prepNum = Math.max(1, Math.ceil(prepLeft / 1000))
  const zone = zoneOf(seconds, band)
  const lo = band?.lo ?? null
  const hi = band?.hi ?? null
  const hadPrep = timer?.prepEndsAt != null

  // Audio cues, once per run: 3-2-1 ticks, "go", tick entering the band, alert at the max.
  useEffect(() => {
    if (!token || !live) return
    if (phase === 'prep') {
      if (claimOnce(`${token}:prep${prepNum}`)) tick()
      return
    }
    if (phase !== 'run') return
    const fresh = (sinceMs: number) => sinceMs >= 0 && sinceMs < CUE_WINDOW_MS
    const runMs = seconds * 1000
    if (hadPrep && claimOnce(`${token}:go`) && fresh(runMs)) goBeep()
    if (lo == null) return
    if (hi != null && seconds >= hi) {
      claimOnce(`${token}:band`)
      if (claimOnce(`${token}:max`) && fresh(runMs - hi * 1000)) alertEnd()
    } else if (seconds >= lo) {
      if (claimOnce(`${token}:band`) && fresh(runMs - lo * 1000)) tick()
    }
  }, [token, live, phase, prepNum, seconds, lo, hi, hadPrep])

  const start = () => {
    if (disabled) return
    unlockAudio()
    startCountUp(id, label, prepSeconds ?? 3)
    onStart?.()
  }

  const stop = () => {
    const cur = getTimer(id)
    if (!cur || cur.mode !== 'countup') return
    if (currentPhase(cur, Date.now()) === 'prep') return
    if (!claimOnce(`${timerToken(id, cur)}:stop`)) return
    const held = Math.floor(elapsedMs(cur, Date.now()) / 1000)
    confirmTap()
    try {
      onStopRef.current(held)
    } finally {
      clearTimer(id)
    }
  }

  const cancel = () => clearTimer(id)

  if (!timer || !phase) {
    return (
      <div className="tm-hold" data-state="idle">
        <button type="button" className="btn btn--primary btn--big btn--block tm-go" disabled={disabled} onClick={start}>
          <IconPlay />
          <span>Via</span>
          <span className="tm-go__label">{label}</span>
        </button>
        {band && (
          <p className="tm-target">
            Obiettivo <strong className="num">{bandText(band)}</strong>
          </p>
        )}
      </div>
    )
  }

  if (phase === 'prep') {
    return (
      <div className="tm-hold" data-state="prep">
        <div className="tm-stage tm-stage--prep" role="timer" aria-label={`${label}: partenza tra ${prepNum}`}>
          <span className="tm-stage__label">{label} · Pronti…</span>
          <span key={prepNum} className="tm-prepnum" aria-hidden="true">
            {prepNum}
          </span>
          {band && <span className="tm-status">Obiettivo {bandText(band)}</span>}
        </div>
        <CancelButton onClick={cancel} />
      </div>
    )
  }

  const status = zone === 'below' && band ? `Obiettivo ${bandText(band)}` : STATUS[zone]
  return (
    <div className="tm-hold" data-state="run">
      <button type="button" className="tm-stage tm-stage--run" data-zone={zone} onClick={stop}>
        <span className="tm-stage__label">{label}</span>
        <span className="bignum tm-big" data-long={seconds >= 100 || undefined}>
          {seconds}
          <span className="tm-unit">s</span>
        </span>
        <span className="tm-status">{status}</span>
        {band && <Scale band={band} ms={ms} />}
        <span className="tm-hint">
          <IconStop />
          Tocca per fermare
        </span>
      </button>
      <CancelButton onClick={cancel} />
      <p className="visually-hidden" aria-live="polite">
        {zone === 'in' ? 'Nel range' : zone === 'over' ? 'Oltre il massimo' : ''}
      </p>
    </div>
  )
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn--ghost tm-cancel" onClick={onClick}>
      <IconClose />
      Annulla
    </button>
  )
}

/** Horizontal scale 0..max with the target band outlined and the elapsed time filled. */
function Scale({ band, ms }: { band: Band; ms: number }) {
  const top = band.hi ?? band.lo
  const max = Math.max(top * 1.25, top + 3)
  const pct = (s: number) => Math.min(100, Math.max(0, (s / max) * 100))
  const left = pct(band.lo)
  const width = band.hi == null ? 100 - left : pct(band.hi) - left
  return (
    <span className="tm-scale" aria-hidden="true">
      <span className="tm-scale__fill" style={{ width: `${pct(ms / 1000)}%` }} />
      <span className="tm-scale__band" data-open={band.hi == null} style={{ left: `${left}%`, width: `${width}%` }} />
      <span className="tm-scale__mark" style={{ left: `${left}%` }}>
        {band.lo}"
      </span>
      {band.hi != null && band.hi !== band.lo && (
        <span className="tm-scale__mark" style={{ left: `${pct(band.hi)}%` }}>
          {band.hi}"
        </span>
      )}
    </span>
  )
}
