import { beforeEach, describe, expect, it } from 'vitest'
import type { EffectiveExercise } from '../../lib/elbow'
import { __resetTimersForTests, getAllTimers, startCountdown, startCountUp } from '../../state/timers'
import { clearExerciseTimers, exerciseTimerPrefix, optionForDuration, timerId, type TrackerTarget } from './tracker'

const D = '2026-10-01'
const target = (index: number): TrackerTarget => ({ date: D, eff: { index } as EffectiveExercise, rows: 3 })

describe('timer ids', () => {
  it('timerId keeps the `${date}#${index}#${set}[#side]` format and starts with the exercise prefix', () => {
    expect(timerId(target(3), 0, null)).toBe(`${D}#3#0`)
    expect(timerId(target(3), 2, 'dx')).toBe(`${D}#3#2#dx`)
    expect(exerciseTimerPrefix(D, 3)).toBe(`${D}#3#`)
    expect(timerId(target(3), 2, 'sx').startsWith(exerciseTimerPrefix(D, 3))).toBe(true)
  })
})

describe('clearExerciseTimers ("Azzera")', () => {
  beforeEach(() => __resetTimersForTests())

  it('removes every row/side timer of the exercise and nothing else', () => {
    startCountUp(`${D}#3#0`, 'L-sit', 3)
    startCountUp(`${D}#3#2#dx`, 'L-sit', 3)
    startCountdown(`${D}#3#1`, 'L-sit', 60)
    startCountUp(`${D}#30#0`, 'Altro', 3)
    startCountUp(`${D}#4#0`, 'Altro', 3)
    startCountUp(`2026-10-02#3#0`, 'Altro giorno', 3)

    clearExerciseTimers(D, 3)

    expect(Object.keys(getAllTimers()).sort()).toEqual([`${D}#30#0`, `${D}#4#0`, `2026-10-02#3#0`].sort())
  })

  it('is a no-op without timers', () => {
    clearExerciseTimers(D, 3)
    expect(getAllTimers()).toEqual({})
  })
})

describe('optionForDuration (time exercise duration chips)', () => {
  it('maps a running countdown back to the option it was started with', () => {
    expect(optionForDuration([20, 30], 'min', 20 * 60_000)).toBe(20)
    expect(optionForDuration([20, 30], 'min', 30 * 60_000)).toBe(30)
    expect(optionForDuration([30, 45], 's', 45_000)).toBe(45)
  })

  it('is undefined without a countdown, for an unknown length or without a timed unit', () => {
    expect(optionForDuration([20, 30], 'min', null)).toBeUndefined()
    expect(optionForDuration([20, 30], 'min', 25 * 60_000)).toBeUndefined()
    expect(optionForDuration([20, 30], null, 20_000)).toBeUndefined()
  })
})
