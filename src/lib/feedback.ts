import { getState, subscribe } from '../state/store'

/**
 * Sound + vibration feedback (Web Audio, navigator.vibrate). Respects settings.sound and
 * settings.vibration from the store. Must never throw (unsupported APIs are no-ops).
 *
 * One shared AudioContext, created/resumed lazily from a user gesture (mobile browsers keep it
 * suspended otherwise). Beeps are synthesised (OscillatorNode + GainNode envelope): no audio files.
 */

type AudioCtor = typeof AudioContext

/** Alert rhythm, shared by sound and vibration: 200 on, 100 off, 200 on, 100 off, 400 on (ms). */
const ALERT_VIBRATION = [200, 100, 200, 100, 400]
const ALERT_BEEPS: ReadonlyArray<readonly [offset: number, duration: number]> = [
  [0, 0.2],
  [0.3, 0.2],
  [0.6, 0.4],
]
const ALERT_HZ = 880
/** Square waves carry harmonics in the 2-4 kHz range: much louder on phone speakers outdoors. */
const ALERT_GAIN = 0.6
/** A beep requested while the context resumes is dropped if it would sound later than this. */
const MAX_RESUME_LAG_MS = 1500
/** A scheduled alert this close to its start counts as played (clock skew, output latency). */
const PLAYED_TOLERANCE_S = 0.15

let ctx: AudioContext | null = null
let master: GainNode | null = null

function soundOn(): boolean {
  try {
    return getState().settings.sound !== false
  } catch {
    return true
  }
}

function vibrationOn(): boolean {
  try {
    return getState().settings.vibration !== false
  } catch {
    return true
  }
}

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as typeof window & { webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function getContext(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx
  const Ctor = audioCtor()
  if (!Ctor) return null
  let created: AudioContext
  try {
    created = new Ctor({ latencyHint: 'interactive' })
  } catch {
    try {
      created = new Ctor()
    } catch {
      return null
    }
  }
  ctx = created
  master = created.createGain()
  master.gain.value = 1
  master.connect(created.destination)
  return created
}

interface Voice {
  osc: OscillatorNode
  gain: GainNode
}

/** One enveloped tone starting at `at` (AudioContext time). */
function tone(c: AudioContext, at: number, hz: number, duration: number, peak: number, type: OscillatorType): Voice {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(hz, at)
  const attack = 0.012
  const release = Math.min(0.05, duration / 3)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + attack)
  gain.gain.setValueAtTime(peak, Math.max(at + attack, at + duration - release))
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(gain)
  gain.connect(master ?? c.destination)
  osc.onended = () => {
    try {
      osc.disconnect()
      gain.disconnect()
    } catch {
      /* already disconnected */
    }
  }
  osc.start(at)
  osc.stop(at + duration + 0.02)
  return { osc, gain }
}

function alertVoices(c: AudioContext, at: number): Voice[] {
  return ALERT_BEEPS.map(([offset, duration]) => tone(c, at + offset, ALERT_HZ, duration, ALERT_GAIN, 'square'))
}

function silence(voices: Voice[]): void {
  for (const v of voices) {
    try {
      v.gain.disconnect()
    } catch {
      /* ignore */
    }
    try {
      v.osc.stop()
    } catch {
      /* not started yet on old engines, or already stopped */
    }
  }
}

/** Plays now if sound is on; if the context is suspended, tries to resume it first. */
function playNow(make: (c: AudioContext, at: number) => void): void {
  if (!soundOn()) return
  const c = getContext()
  if (!c) return
  if (c.state === 'running') {
    make(c, c.currentTime + 0.01)
    return
  }
  const requestedAt = Date.now()
  Promise.resolve(c.resume())
    .then(() => {
      // Without a user gesture the resume may only succeed much later: never play stale beeps.
      if (c.state === 'running' && Date.now() - requestedAt < MAX_RESUME_LAG_MS) make(c, c.currentTime + 0.01)
    })
    .catch(() => {})
}

function vibrate(pattern: number | number[]): void {
  if (!vibrationOn()) return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* unsupported or blocked */
  }
}

/** Creates/resumes the shared AudioContext. Call from a user gesture (e.g. "Inizia"). */
export function unlockAudio(): void {
  try {
    const c = getContext()
    if (!c || c.state === 'running') return
    Promise.resolve(c.resume()).catch(() => {})
    // iOS only unlocks output once something actually plays inside the gesture.
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, 22050)
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* audio unavailable */
  }
}

/** Short tick for 3-2-1 countdowns. */
export function tick(): void {
  try {
    playNow((c, at) => {
      tone(c, at, 660, 0.07, 0.35, 'square')
    })
  } catch {
    /* ignore */
  }
}

/** "Go" cue when a 3-2-1 preparation ends. */
export function goBeep(): void {
  try {
    playNow((c, at) => {
      tone(c, at, 990, 0.3, 0.5, 'square')
    })
  } catch {
    /* ignore */
  }
}

/**
 * End-of-timer alert: 3 loud beeps (~880 Hz square/sine) + vibration [200,100,200,100,400].
 * With the handle of a scheduleAlertAt() call: if those beeps already sounded on the audio
 * clock only the vibration fires (no double beep); otherwise they are cancelled and the beeps
 * play now.
 */
export function alertEnd(scheduled?: ScheduledAlert | null): void {
  try {
    vibrate(ALERT_VIBRATION)
    if (scheduled?.played()) return
    scheduled?.()
    playNow((c, at) => {
      alertVoices(c, at)
    })
  } catch {
    /* ignore */
  }
}

/** Light confirmation (e.g. set done): short vibration only. */
export function confirmTap(): void {
  try {
    vibrate(30)
  } catch {
    /* ignore */
  }
}

/** Handle of scheduleAlertAt(): call it to cancel the queued beeps. */
export interface ScheduledAlert {
  (): void
  /** True while beeps are queued on the audio clock (audio unlocked, sound on, end in the future, not cancelled). */
  readonly scheduled: boolean
  /** True once the queued beeps have started (or are about to): no need to beep again. */
  played(): boolean
}

const pendingAlerts = new Set<() => void>()

/**
 * Queues the 3 end beeps on the AudioContext clock at `epochMs`, so they sound on time even when
 * JS timers are throttled in background. Vibration cannot be scheduled: call
 * alertEnd(handle) when the UI notices the end. Returns the cancel function.
 */
export function scheduleAlertAt(epochMs: number): ScheduledAlert {
  let voices: Voice[] = []
  let when = Number.POSITIVE_INFINITY
  let c: AudioContext | null = null
  try {
    c = soundOn() ? getContext() : null
    const delayS = (epochMs - Date.now()) / 1000
    if (c && c.state === 'running' && Number.isFinite(delayS) && delayS > 0.05) {
      when = c.currentTime + delayS
      voices = alertVoices(c, when)
    }
  } catch {
    silence(voices)
    voices = []
  }
  let cancelled = false
  const cancel = () => {
    pendingAlerts.delete(cancel)
    if (cancelled) return
    cancelled = true
    silence(voices)
  }
  const played = () => {
    try {
      return !cancelled && voices.length > 0 && c != null && c.state === 'running' && c.currentTime >= when - PLAYED_TOLERANCE_S
    } catch {
      return false
    }
  }
  if (voices.length > 0) {
    pendingAlerts.add(cancel)
    voices[voices.length - 1].osc.addEventListener('ended', () => pendingAlerts.delete(cancel))
  }
  return Object.defineProperties(cancel, {
    scheduled: { get: () => voices.length > 0 && !cancelled },
    played: { value: played },
  }) as unknown as ScheduledAlert
}

// Browser-only setup.
if (typeof window !== 'undefined') {
  // Unlock audio on the first tap/key (iOS/Android keep the context suspended until a gesture);
  // the listener stays cheap afterwards and re-unlocks if the system suspends the context again.
  const onGesture = () => {
    if (!ctx || ctx.state !== 'running') unlockAudio()
  }
  for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, onGesture, { capture: true, passive: true })
  }
  // Sound switched off: drop the beeps already queued on the audio clock.
  subscribe(() => {
    if (pendingAlerts.size > 0 && !soundOn()) for (const cancel of [...pendingAlerts]) cancel()
  })
}
