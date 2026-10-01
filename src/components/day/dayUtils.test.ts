import { describe, expect, it } from 'vitest'
import fixture from '../../../scheda-corrente.json'
import { parsePlan } from '../../plan/schema'
import type { Day, Plan } from '../../plan/schema'
import { applyElbow, sessionElbowLevel } from '../../lib/elbow'
import { createCountdown, createCountUp, pausedState, type TimerMap } from '../../state/timers'
import type { ExerciseLog, SessionLog, SetLog } from '../../state/types'
import {
  elbowSettled,
  firstIncompletePos,
  initialSlide,
  isComplete,
  nextIncompletePos,
  plannedSets,
  previousDate,
  sessionProgress,
  sessionRunning,
  workoutActiveUntil,
} from './dayUtils'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

const plan = loadPlan()
const dayOf = (date: string): Day => {
  const d = plan.days.find((x) => x.date === date)
  if (!d) throw new Error(`missing day ${date}`)
  return d
}
const SPINTA = dayOf('2026-10-01')
const TIRATA = dayOf('2026-10-02')
const GAMBE = dayOf('2026-10-03')

const done = (value: number | null = null): SetLog => ({ done: true, value })
const sides = (value: number): SetLog => ({
  done: true,
  value: null,
  dx: { done: true, value },
  sx: { done: true, value },
})

function logOf(day: Day, index: number, sets: SetLog[]): ExerciseLog {
  const ex = day.exercises[index]
  return {
    index,
    key: ex.key,
    name: ex.name,
    kind: ex.kind,
    unit: ex.unit,
    measure: plan.library[ex.key]?.measure ?? null,
    test: ex.test,
    perSide: ex.per_side,
    setsPlanned: ex.sets ?? 0,
    sets,
  }
}

function session(day: Day, patch: Partial<SessionLog> = {}): SessionLog {
  return {
    date: day.date,
    planId: plan.id,
    dayType: day.type,
    dayTitle: day.title,
    startedAt: null,
    finishedAt: null,
    elbowPre: null,
    elbowOverride: null,
    rpe: null,
    elbowDuring: null,
    notes: '',
    skipped: false,
    exercises: {},
    ...patch,
  }
}

const effsOf = (day: Day, s: SessionLog | undefined) => applyElbow(day, plan.library, sessionElbowLevel(s, plan.elbow))

/** Every visible planned set done, except the exercise indexes in `skip`. */
function fullSession(day: Day, patch: Partial<SessionLog> = {}, skip: number[] = []): SessionLog {
  const s = session(day, { startedAt: `${day.date}T07:00:00.000Z`, ...patch })
  for (const e of effsOf(day, s)) {
    if (e.hidden || e.ex.kind === 'info' || skip.includes(e.index)) continue
    const set = () => (e.ex.per_side ? sides(1) : done(1))
    s.exercises[String(e.index)] = logOf(day, e.index, Array.from({ length: e.sets ?? 1 }, set))
  }
  return s
}

describe('plannedSets / isComplete', () => {
  it('reads sets: null on a tracked exercise as 1 planned set (the card shows one row)', () => {
    const day: Day = { ...SPINTA, exercises: SPINTA.exercises.map((e, i) => (i === 0 ? { ...e, sets: null } : e)) }
    const eff = effsOf(day, undefined)[0]
    expect(plannedSets(eff)).toBe(1)
    expect(isComplete(eff, undefined)).toBe(false)
    const s = session(day, { exercises: { '0': logOf(day, 0, [done(600)]) } })
    expect(isComplete(eff, s)).toBe(true)
    expect(sessionProgress([eff], s)).toEqual({ done: 1, planned: 1 })
  })

  it('info exercises are always complete and never planned', () => {
    const rest = dayOf('2026-10-04')
    const effs = effsOf(rest, undefined)
    expect(effs.every((e) => isComplete(e, undefined))).toBe(true)
    expect(sessionProgress(effs, undefined)).toEqual({ done: 0, planned: 0 })
  })

  it('a manual traffic light without a score settles the elbow check', () => {
    const s = session(TIRATA, { elbowOverride: 'green' })
    expect(elbowSettled(s)).toBe(true)
    const effs = effsOf(TIRATA, s)
    expect(isComplete(effs[0], s)).toBe(true)
    const full = fullSession(TIRATA, { elbowOverride: 'green' }, [0])
    const p = sessionProgress(effsOf(TIRATA, full), full)
    expect(p.done).toBe(p.planned)
  })

  it('the elbow check stays to do without score or colour', () => {
    const s = session(TIRATA)
    expect(elbowSettled(s)).toBe(false)
    expect(isComplete(effsOf(TIRATA, s)[0], s)).toBe(false)
  })
})

describe('sessionProgress', () => {
  it('leaves optional exercises (block "Opzionale") out of done and planned', () => {
    const s = fullSession(GAMBE, {}, [8])
    expect(sessionProgress(effsOf(GAMBE, s), s)).toEqual({ done: 18, planned: 18 })
    const withWalk = fullSession(GAMBE)
    expect(sessionProgress(effsOf(GAMBE, withWalk), withWalk)).toEqual({ done: 18, planned: 18 })
  })

  it('does not count sets of exercises hidden by a later elbow change', () => {
    const s = session(TIRATA, { startedAt: '2026-10-02T07:00:00.000Z', elbowPre: 7 })
    const green = [1, 3, 1, 3, 3, 4]
    green.forEach((n, i) => {
      s.exercises[String(i)] = logOf(TIRATA, i, Array.from({ length: n }, () => done(1)))
    })
    expect(sessionProgress(effsOf(TIRATA, s), s)).toEqual({ done: 5, planned: 15 })
  })

  it('counts extra sets on a visible exercise', () => {
    const s = fullSession(SPINTA)
    s.exercises['1'] = logOf(SPINTA, 1, [done(1), done(1), done(1), done(1)])
    const p = sessionProgress(effsOf(SPINTA, s), s)
    expect(p.done).toBe(p.planned + 1)
  })
})

describe('workoutActiveUntil', () => {
  const H = 3_600_000
  const WINDOW = 3 * H
  const now = Date.UTC(2026, 9, 1, 18, 0)
  const none: TimerMap = {}

  it('is null with nothing going on', () => {
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers: none }, now, WINDOW)).toBeNull()
  })

  it('an open session counts for the window after its start, then stops', () => {
    const start = now - H
    expect(workoutActiveUntil({ openSessionStart: start, restEndAt: null, timers: none }, now, WINDOW)).toBe(
      start + WINDOW,
    )
    expect(
      workoutActiveUntil({ openSessionStart: now - 4 * H, restEndAt: null, timers: none }, now, WINDOW),
    ).toBeNull()
  })

  it('a running rest counts until its end', () => {
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: now + 90_000, timers: none }, now, WINDOW)).toBe(
      now + 90_000,
    )
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: now - 1, timers: none }, now, WINDOW)).toBeNull()
  })

  it('a running countdown (warm-up before "Inizia sessione") counts until its end', () => {
    const timers: TimerMap = { '2026-10-01#0#0': createCountdown('Riscaldamento', 600, now - 60_000) }
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers }, now, WINDOW)).toBe(
      now - 60_000 + 600_000,
    )
    const ended: TimerMap = { x: createCountdown('Riscaldamento', 60, now - 120_000) }
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers: ended }, now, WINDOW)).toBeNull()
  })

  it('a paused timer does not count', () => {
    const paused = pausedState(createCountdown('Riscaldamento', 600, now - 60_000), now - 30_000)
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers: { x: paused } }, now, WINDOW)).toBeNull()
  })

  it('a running count-up counts for the window after it was started', () => {
    const t = createCountUp('L-sit', 3, now - 10_000)
    expect(workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers: { x: t } }, now, WINDOW)).toBe(
      now - 10_000 + WINDOW,
    )
    const forgotten = createCountUp('L-sit', 3, now - 4 * H)
    expect(
      workoutActiveUntil({ openSessionStart: null, restEndAt: null, timers: { x: forgotten } }, now, WINDOW),
    ).toBeNull()
  })

  it('takes the latest of all sources', () => {
    const timers: TimerMap = { x: createCountdown('Camminata', 30 * 60, now) }
    expect(
      workoutActiveUntil({ openSessionStart: now - 2.9 * H, restEndAt: now + 60_000, timers }, now, WINDOW),
    ).toBe(now + 30 * 60_000)
  })
})

describe('sessionRunning', () => {
  const now = Date.parse('2026-10-02T00:00:30+02:00')
  const WINDOW = 6 * 3_600_000

  it('is true for a session started recently and not closed', () => {
    expect(sessionRunning(session(SPINTA, { startedAt: '2026-10-01T21:20:00.000Z' }), now, WINDOW)).toBe(true)
  })

  it('is false without a session, when closed, skipped or started too long ago', () => {
    expect(sessionRunning(undefined, now, WINDOW)).toBe(false)
    expect(sessionRunning(session(SPINTA), now, WINDOW)).toBe(false)
    const started = '2026-10-01T21:20:00.000Z'
    expect(sessionRunning(session(SPINTA, { startedAt: started, finishedAt: '2026-10-01T22:00:00.000Z' }), now, WINDOW)).toBe(false)
    expect(sessionRunning(session(SPINTA, { startedAt: started, skipped: true }), now, WINDOW)).toBe(false)
    expect(sessionRunning(session(SPINTA, { startedAt: '2026-10-01T10:00:00.000Z' }), now, WINDOW)).toBe(false)
    expect(sessionRunning(session(SPINTA, { startedAt: 'garbage' }), now, WINDOW)).toBe(false)
  })
})

describe('previousDate', () => {
  it('steps back one calendar day across month, year and leap boundaries', () => {
    expect(previousDate('2026-10-02')).toBe('2026-10-01')
    expect(previousDate('2026-10-01')).toBe('2026-09-30')
    expect(previousDate('2026-01-01')).toBe('2025-12-31')
    expect(previousDate('2026-03-01')).toBe('2026-02-28')
    expect(previousDate('2024-03-01')).toBe('2024-02-29')
    expect(previousDate('2026-03-30')).toBe('2026-03-29')
  })

  it('rejects malformed or impossible dates', () => {
    expect(previousDate('')).toBeNull()
    expect(previousDate('2026-10-1')).toBeNull()
    expect(previousDate('2026-02-30')).toBeNull()
    expect(previousDate('2026-13-01')).toBeNull()
  })
})

describe('exercise carousel positions', () => {
  // Exercise indexes in carousel order (main first, then home) and their completion.
  const order = [0, 2, 3, 5, 9]
  const complete = new Map([
    [0, true],
    [2, true],
    [3, false],
    [5, true],
    [9, false],
  ])

  it('starts on the first incomplete exercise, or the first one when all are done', () => {
    expect(firstIncompletePos(order, complete)).toBe(2)
    expect(firstIncompletePos(order, new Map(order.map((i) => [i, true])))).toBe(0)
    expect(firstIncompletePos([], complete)).toBe(0)
  })

  it('advances forward to the next incomplete exercise, never backwards', () => {
    expect(nextIncompletePos(order, complete, 2)).toBe(4)
    expect(nextIncompletePos(order, complete, 0)).toBe(2)
    expect(nextIncompletePos(order, complete, 4)).toBe(-1)
  })

  it('reopens on the remembered exercise while it is still shown', () => {
    expect(initialSlide(order, complete, 5)).toBe(5)
    // Hidden by an elbow change (no longer in the order): first incomplete instead.
    expect(initialSlide(order, complete, 7)).toBe(3)
    expect(initialSlide(order, complete, null)).toBe(3)
    expect(initialSlide([], complete, 5)).toBeNull()
  })
})
