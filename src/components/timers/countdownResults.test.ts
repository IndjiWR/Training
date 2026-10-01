import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../../scheda-corrente.json'
import { parsePlan, type Plan } from '../../plan/schema'
import { clearAllData, setPlan, updateSet } from '../../state/actions'
import { getState } from '../../state/store'
import {
  __resetTimersForTests,
  claimOnce,
  createCountdown,
  getTimer,
  startCountdown,
  timerToken,
  type TimerMap,
} from '../../state/timers'
import { getRestTimer, stopRest } from '../../state/ui'
import { parseTimerId, recordCountdownResult, watchCountdowns } from './countdownResults'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

const DATE = '2026-10-01' // SPINTA: #0 riscaldamento-spinta, time 10 min, no rest
const T0 = 1_790_000_000_000

const setOf = (date: string, index: number, set: number) => getState().sessions[date]?.exercises[String(index)]?.sets[set]

beforeEach(() => {
  vi.stubGlobal('localStorage', undefined)
  clearAllData(false)
  setPlan(loadPlan(), 'example')
  stopRest()
  __resetTimersForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseTimerId', () => {
  it('reads date, exercise, set and optional side', () => {
    expect(parseTimerId('2026-10-01#0#2')).toEqual({ date: '2026-10-01', index: 0, setIndex: 2, side: null })
    expect(parseTimerId('2026-10-03#4#0#sx')).toEqual({ date: '2026-10-03', index: 4, setIndex: 0, side: 'sx' })
  })

  it('rejects other ids', () => {
    for (const id of ['', 'cd', 'elbow', '2026-10-01#0', '2026-10-01#a#0', '2026-10-01#0#-1', '2026-10-01#0#1.5', '2026-10-01#0#0#up', '#0#0', '2026-10-01#0#0#dx#x']) {
      expect(parseTimerId(id)).toBeNull()
    }
  })
})

describe('recordCountdownResult', () => {
  it('confirms the set with the seconds and starts the session', () => {
    expect(recordCountdownResult(`${DATE}#0#0`, 600)).toBe(true)
    expect(setOf(DATE, 0, 0)).toMatchObject({ done: true, value: 600 })
    expect(getState().sessions[DATE]?.startedAt).toBeTruthy()
    expect(getRestTimer()).toBeNull() // the warm-up has no rest
  })

  it('starts the rest like the card when it completes a set (per side: after both sides)', () => {
    const plan = structuredClone(loadPlan())
    const day = plan.days.find((d) => d.date === DATE)!
    day.exercises[0] = { ...day.exercises[0], per_side: true, rest_s: 60, rest_max_s: 90 }
    setPlan(plan, 'example')

    recordCountdownResult(`${DATE}#0#0#dx`, 600)
    expect(setOf(DATE, 0, 0)).toMatchObject({ done: false, dx: { done: true, value: 600 } })
    expect(getRestTimer()).toBeNull()

    recordCountdownResult(`${DATE}#0#0#sx`, 600)
    expect(setOf(DATE, 0, 0)).toMatchObject({ done: true, sx: { done: true, value: 600 } })
    const rest = getRestTimer()
    expect(rest?.baseS).toBe(60)
    expect(rest?.maxS).toBe(90)
    expect(rest?.label).toContain('serie 1/1')
  })

  it('does not restart the rest for a set that was already done', () => {
    const plan = structuredClone(loadPlan())
    const day = plan.days.find((d) => d.date === DATE)!
    day.exercises[0] = { ...day.exercises[0], rest_s: 60 }
    setPlan(plan, 'example')
    updateSet(DATE, 0, 0, { done: true, value: 300 })

    recordCountdownResult(`${DATE}#0#0`, 600)
    expect(setOf(DATE, 0, 0)).toMatchObject({ done: true, value: 600 })
    expect(getRestTimer()).toBeNull()
  })

  it('ignores unknown ids, days and exercises', () => {
    expect(recordCountdownResult('cd', 10)).toBe(false)
    expect(recordCountdownResult('2030-01-01#0#0', 10)).toBe(false)
    expect(recordCountdownResult(`${DATE}#99#0`, 10)).toBe(false)
    expect(getState().sessions).toEqual({})
  })
})

describe('watchCountdowns', () => {
  const id = `${DATE}#0#0`
  const ended = (): TimerMap => ({ [id]: createCountdown('Riscaldamento', 600, T0) })
  const AFTER_END = T0 + 600_000 + 5_000

  it('an ended countdown with no mounted card is recorded once and marked done', () => {
    startCountdown(id, 'Riscaldamento', 600, T0)
    const all = { [id]: getTimer(id)! }

    watchCountdowns(all, {}, AFTER_END)
    expect(setOf(DATE, 0, 0)).toMatchObject({ done: true, value: 600 })
    expect(getTimer(id)?.phase).toBe('done')

    // A later pass (stale snapshot) does not record again.
    updateSet(DATE, 0, 0, { value: 1 })
    watchCountdowns(all, {}, AFTER_END + 1000)
    expect(setOf(DATE, 0, 0)?.value).toBe(1)
  })

  it('leaves the ended countdown of a mounted card to the card', () => {
    startCountdown(id, 'Riscaldamento', 600, T0)
    watchCountdowns({ [id]: getTimer(id)! }, { [id]: false }, AFTER_END)
    expect(setOf(DATE, 0, 0)).toBeUndefined()
    expect(getTimer(id)?.phase).toBe('run')
  })

  it('does not record a run the card already completed', () => {
    const all = ended()
    claimOnce(`${timerToken(id, all[id])}:complete`)
    watchCountdowns(all, {}, AFTER_END)
    expect(setOf(DATE, 0, 0)).toBeUndefined()
  })

  it('keeps the alarm of countdowns still running and records nothing', () => {
    startCountdown(id, 'Riscaldamento', 600, T0)
    const t = getTimer(id)!
    const keep = watchCountdowns({ [id]: t }, {}, T0 + 1000)
    expect(keep.size).toBe(1)
    expect(setOf(DATE, 0, 0)).toBeUndefined()
    expect(getTimer(id)?.phase).toBe('run')
  })
})
