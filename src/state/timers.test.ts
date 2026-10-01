import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTimersForTests,
  claimOnce,
  clearTimer,
  createCountdown,
  createCountUp,
  currentPhase,
  doneState,
  elapsedMs,
  endsAt,
  getAllTimers,
  getTimer,
  markDone,
  pausedState,
  pauseTimer,
  prepRemainingMs,
  pruneTimers,
  remainingMs,
  resumedState,
  resumeTimer,
  startCountdown,
  startCountUp,
  TIMER_MAX_AGE_MS,
  TIMERS_KEY,
  timerToken,
  type TimerState,
} from './timers'

const T0 = 1_790_000_000_000
const s = (n: number) => n * 1000

describe('count-up', () => {
  it('3-2-1 preparation, then counts from the end of the preparation', () => {
    const t = createCountUp('L-sit', 3, T0)
    expect(t.phase).toBe('prep')
    expect(currentPhase(t, T0 + s(1))).toBe('prep')
    expect(prepRemainingMs(t, T0 + s(1))).toBe(s(2))
    expect(Math.ceil(prepRemainingMs(t, T0 + 2500) / 1000)).toBe(1)
    expect(elapsedMs(t, T0 + s(2))).toBe(0)

    expect(currentPhase(t, T0 + s(3))).toBe('run')
    expect(elapsedMs(t, T0 + s(3))).toBe(0)
    expect(elapsedMs(t, T0 + 13_500)).toBe(10_500)
    expect(remainingMs(t, T0 + s(20))).toBe(Number.POSITIVE_INFINITY)
    expect(endsAt(t)).toBeNull()
  })

  it('without preparation runs immediately', () => {
    const t = createCountUp('Stopwatch', 0, T0)
    expect(t.phase).toBe('run')
    expect(t.prepEndsAt).toBeNull()
    expect(prepRemainingMs(t, T0)).toBe(0)
    expect(elapsedMs(t, T0 + s(7))).toBe(s(7))
  })

  it('cannot be paused during the preparation', () => {
    const t = createCountUp('Hold', 3, T0)
    expect(pausedState(t, T0 + s(1))).toBe(t)
  })

  it('done freezes the elapsed time', () => {
    const t = doneState(createCountUp('Hold', 3, T0), T0 + s(15))
    expect(t.phase).toBe('done')
    expect(elapsedMs(t, T0 + s(15))).toBe(s(12))
    expect(elapsedMs(t, T0 + s(600))).toBe(s(12))
    expect(currentPhase(t, T0 + s(600))).toBe('done')
  })
})

describe('countdown', () => {
  it('remaining time, end and done phase', () => {
    const t = createCountdown('Riscaldamento', 600, T0)
    expect(currentPhase(t, T0)).toBe('run')
    expect(remainingMs(t, T0 + s(30))).toBe(s(570))
    expect(endsAt(t)).toBe(T0 + s(600))
    expect(currentPhase(t, T0 + s(599))).toBe('run')
    expect(currentPhase(t, T0 + s(600))).toBe('done')
    expect(remainingMs(t, T0 + s(700))).toBe(0)
    expect(elapsedMs(t, T0 + s(700))).toBe(s(600))
  })

  it('pause/resume excludes the paused time', () => {
    let t = createCountdown('Mobilità', 60, T0)
    t = pausedState(t, T0 + s(10))
    expect(t.phase).toBe('paused')
    expect(currentPhase(t, T0 + s(40))).toBe('paused')
    expect(elapsedMs(t, T0 + s(40))).toBe(s(10))
    expect(remainingMs(t, T0 + s(40))).toBe(s(50))
    expect(endsAt(t)).toBeNull()

    t = resumedState(t, T0 + s(40))
    expect(t.phase).toBe('run')
    expect(t.pausedMs).toBe(s(30))
    expect(elapsedMs(t, T0 + s(50))).toBe(s(20))
    expect(endsAt(t)).toBe(T0 + s(90))
    expect(currentPhase(t, T0 + s(89))).toBe('run')
    expect(currentPhase(t, T0 + s(90))).toBe('done')
  })

  it('pause and resume are no-ops in the wrong phase', () => {
    const t = createCountdown('X', 10, T0)
    expect(resumedState(t, T0 + s(1))).toBe(t)
    expect(pausedState(t, T0 + s(11))).toBe(t)
  })

  it('done caps the elapsed time at the end and keeps a paused value', () => {
    const late = doneState(createCountdown('X', 60, T0), T0 + s(300))
    expect(late.doneAt).toBe(T0 + s(60))
    expect(elapsedMs(late, T0 + s(900))).toBe(s(60))

    const early = doneState(createCountdown('X', 60, T0), T0 + s(25))
    expect(elapsedMs(early, T0 + s(900))).toBe(s(25))

    const fromPause = doneState(pausedState(createCountdown('X', 60, T0), T0 + s(5)), T0 + s(50))
    expect(elapsedMs(fromPause, T0 + s(900))).toBe(s(5))
    expect(doneState(fromPause, T0 + s(999))).toBe(fromPause)
  })

  it('a zero or invalid length is already done', () => {
    expect(currentPhase(createCountdown('X', 0, T0), T0)).toBe('done')
    expect(createCountdown('X', Number.NaN, T0).durationMs).toBe(0)
  })
})

describe('pruneTimers', () => {
  const fresh = createCountdown('fresh', 60, T0)
  const old = createCountdown('old', 60, T0 - TIMER_MAX_AGE_MS - 1)

  it('drops timers older than 12 h and malformed entries', () => {
    const out = pruneTimers(
      { fresh, old, bad: { mode: 'countdown', phase: 'run' }, nope: 42, legacy: { ...fresh, doneAt: undefined } },
      T0,
    )
    expect(Object.keys(out).sort()).toEqual(['fresh', 'legacy'])
    expect(out.legacy.doneAt).toBeNull()
  })

  it('accepts only objects', () => {
    expect(pruneTimers(null, T0)).toEqual({})
    expect(pruneTimers([fresh], T0)).toEqual({})
    expect(pruneTimers('x', T0)).toEqual({})
  })
})

describe('store API (in memory)', () => {
  beforeEach(() => __resetTimersForTests())

  it('start, pause, resume, done, clear', () => {
    startCountdown('cd', 'Riscaldamento', 120, T0)
    const started = getTimer('cd') as TimerState
    expect(started.mode).toBe('countdown')

    pauseTimer('cd', T0 + s(20))
    expect(getTimer('cd')?.phase).toBe('paused')
    resumeTimer('cd', T0 + s(50))
    expect(getTimer('cd')?.pausedMs).toBe(s(30))
    expect(remainingMs(getTimer('cd') as TimerState, T0 + s(60))).toBe(s(90))

    markDone('cd', T0 + s(500))
    const done = getTimer('cd') as TimerState
    expect(done.phase).toBe('done')
    expect(elapsedMs(done, T0 + s(9999))).toBe(s(120))

    clearTimer('cd')
    expect(getTimer('cd')).toBeNull()
    expect(getAllTimers()).toEqual({})
  })

  it('keeps every change immutable (stable snapshots for useSyncExternalStore)', () => {
    startCountUp('h', 'Hold', 3, T0)
    const before = getAllTimers()
    const t = getTimer('h')
    pauseTimer('h', T0 + s(1)) // no-op during prep
    expect(getAllTimers()).toBe(before)
    startCountUp('other', 'Other', 0, T0)
    expect(getAllTimers()).not.toBe(before)
    expect(getTimer('h')).toBe(t)
  })

  it('a restart gets a new token even within the same millisecond', () => {
    startCountUp('h', 'Hold', 0, T0)
    const a = timerToken('h', getTimer('h') as TimerState)
    startCountUp('h', 'Hold', 0, T0)
    const b = timerToken('h', getTimer('h') as TimerState)
    expect(a).not.toBe(b)
  })

  it('uses Date.now() by default', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      startCountUp('h', 'Hold', 3)
      vi.setSystemTime(T0 + s(8))
      expect(elapsedMs(getTimer('h') as TimerState, Date.now())).toBe(s(5))
    } finally {
      vi.useRealTimers()
    }
  })

  it('claimOnce fires once per key', () => {
    expect(claimOnce('x@1:end')).toBe(true)
    expect(claimOnce('x@1:end')).toBe(false)
    expect(claimOnce('x@2:end')).toBe(true)
  })
})

describe('persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads (pruned) from localStorage and saves every change', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    })
    const now = Date.now()
    mem.set(
      TIMERS_KEY,
      JSON.stringify({
        fresh: createCountdown('fresh', 60, now - s(30)),
        stale: createCountdown('stale', 60, now - TIMER_MAX_AGE_MS - s(1)),
      }),
    )
    vi.resetModules()
    const mod = await import('./timers')
    expect(Object.keys(mod.getAllTimers())).toEqual(['fresh'])

    mod.startCountUp('hold', 'Hold', 3)
    const saved = JSON.parse(mem.get(TIMERS_KEY) as string) as Record<string, TimerState>
    expect(Object.keys(saved).sort()).toEqual(['fresh', 'hold'])
    expect(saved.hold.phase).toBe('prep')

    mod.clearTimer('hold')
    mod.clearTimer('fresh')
    expect(mem.has(TIMERS_KEY)).toBe(false)
  })

  it('works without localStorage', async () => {
    vi.stubGlobal('localStorage', undefined)
    vi.resetModules()
    const mod = await import('./timers')
    mod.startCountdown('cd', 'X', 30)
    expect(mod.getTimer('cd')?.durationMs).toBe(s(30))
  })
})
