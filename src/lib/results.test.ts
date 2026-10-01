import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Day, Exercise, Plan } from '../plan/schema'
import type { ExerciseLog, SessionLog, SetLog } from '../state/types'
import {
  bestResult,
  isSetDone,
  latestResult,
  lowerIsBetter,
  percentOf,
  recordedValues,
  resolvePercentMax,
  setsDone,
} from './results'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

const plan = loadPlan()
const SPINTA: Day = plan.days[0]

/* ── builders ── */

const done = (value: number | null): SetLog => ({ done: true, value })
const open = (value: number | null = null): SetLog => ({ done: false, value })
const sides = (dx: number | null, sx: number | null, dxDone = true, sxDone = true): SetLog => ({
  done: dxDone && sxDone,
  value: null,
  dx: { done: dxDone, value: dx },
  sx: { done: sxDone, value: sx },
})

/** Exercise log copied from a plan exercise (as the store does). */
function logOf(day: Day, index: number, sets: SetLog[], patch: Partial<ExerciseLog> = {}): ExerciseLog {
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
    ...patch,
  }
}

function session(date: string, logs: ExerciseLog[], patch: Partial<SessionLog> = {}): SessionLog {
  return {
    date,
    planId: plan.id,
    dayType: 'SPINTA',
    dayTitle: null,
    startedAt: `${date}T08:00:00.000Z`,
    finishedAt: null,
    elbowPre: null,
    elbowOverride: null,
    rpe: null,
    elbowDuring: null,
    notes: '',
    skipped: false,
    exercises: Object.fromEntries(logs.map((l) => [String(l.index), l])),
    ...patch,
  }
}

const byDate = (...list: SessionLog[]): Record<string, SessionLog> => Object.fromEntries(list.map((s) => [s.date, s]))

/* ── fixture exercises ── */

const DIP_MAX = 5
const DIP_PCT = 6
const dipMaxEx = SPINTA.exercises[DIP_MAX]
const dipPctEx = SPINTA.exercises[DIP_PCT]
const AT = { date: SPINTA.date, index: DIP_PCT }

/** Session of 2026-10-01 with the dip max recorded at index 5. */
const withMax = (date: string, value: number, extra: ExerciseLog[] = []) =>
  session(date, [logOf(SPINTA, DIP_MAX, [done(value)]), ...extra])

describe('fixture sanity for %max', () => {
  it('has "Dip massimali" at index 5 and "Dip 3 × 60%" at index 6', () => {
    expect(dipMaxEx).toMatchObject({ key: 'dip', kind: 'max', unit: 'rep', test: true })
    expect(dipMaxEx.name).toMatch(/^Dip massimali/)
    expect(dipPctEx).toMatchObject({ key: 'dip', kind: 'reps', unit: '%max', target_min: 60, target_max: 60, sets: 3 })
    expect(dipPctEx.note).toContain('max 20 -> 3 × 12')
  })
})

describe('percentOf', () => {
  it('rounds to the nearest integer (half up)', () => {
    expect(percentOf(60, 20)).toBe(12)
    expect(percentOf(60, 17)).toBe(10)
    expect(percentOf(60, 18)).toBe(11)
    expect(percentOf(70, 15)).toBe(11) // 10.5
    expect(percentOf(50, 3)).toBe(2) // 1.5
    expect(percentOf(100, 23)).toBe(23)
    expect(percentOf(60, 0)).toBe(0)
  })
})

describe('resolvePercentMax', () => {
  it('uses the max recorded earlier the same day (the plan example: max 20 -> 3 × 12)', () => {
    const r = resolvePercentMax(dipPctEx, byDate(withMax('2026-10-01', 20)), AT)
    expect(r).toEqual({ min: 12, max: 12, base: 20, baseDate: '2026-10-01', pctMin: 60, pctMax: 60, sides: null })
  })

  it('rounds the reps', () => {
    expect(resolvePercentMax(dipPctEx, byDate(withMax('2026-10-01', 17)), AT)?.max).toBe(10)
    expect(resolvePercentMax(dipPctEx, byDate(withMax('2026-10-01', 18)), AT)?.max).toBe(11)
  })

  it('is null without a recorded max', () => {
    expect(resolvePercentMax(dipPctEx, {}, AT)).toBeNull()
    const notDone = session('2026-10-01', [logOf(SPINTA, DIP_MAX, [open(20)])])
    expect(resolvePercentMax(dipPctEx, byDate(notDone), AT)).toBeNull()
    const noValue = session('2026-10-01', [logOf(SPINTA, DIP_MAX, [done(null)])])
    expect(resolvePercentMax(dipPctEx, byDate(noValue), AT)).toBeNull()
  })

  it('is null when the latest max is not positive', () => {
    expect(resolvePercentMax(dipPctEx, byDate(withMax('2026-10-01', 0)), AT)).toBeNull()
  })

  it('takes the latest result across dates', () => {
    const sessions = byDate(withMax('2026-09-24', 25), withMax('2026-10-01', 20))
    expect(resolvePercentMax(dipPctEx, sessions, AT)).toMatchObject({ base: 20, baseDate: '2026-10-01', max: 12 })
  })

  it('falls back to an older week when today has no max yet', () => {
    const sessions = byDate(withMax('2026-09-24', 25), session('2026-10-01', []))
    expect(resolvePercentMax(dipPctEx, sessions, AT)).toMatchObject({ base: 25, baseDate: '2026-09-24', max: 15 })
  })

  it('ignores results recorded after `at` (later index or later date)', () => {
    const laterIndex = logOf(SPINTA, 8, [done(30)], { key: 'dip', kind: 'max', unit: 'rep' })
    const sessions = byDate(withMax('2026-09-24', 25), session('2026-10-01', [laterIndex]), withMax('2026-10-08', 40))
    expect(resolvePercentMax(dipPctEx, sessions, AT)).toMatchObject({ base: 25, baseDate: '2026-09-24' })
  })

  it('never reads its own result', () => {
    const self = logOf(SPINTA, DIP_PCT, [done(30)], { kind: 'max' })
    const sessions = byDate(withMax('2026-09-24', 25), session('2026-10-01', [self]))
    expect(latestResult(sessions, 'dip', AT)).toEqual({ value: 25, date: '2026-09-24', index: DIP_MAX, dx: null, sx: null })
  })

  it('does not treat reps logs of the same key as results', () => {
    const reps = logOf(SPINTA, DIP_PCT, [done(15), done(15), done(15)])
    const sessions = byDate(withMax('2026-09-24', 25), session('2026-09-28', [reps]))
    expect(resolvePercentMax(dipPctEx, sessions, AT)).toMatchObject({ base: 25, baseDate: '2026-09-24' })
    expect(resolvePercentMax(dipPctEx, byDate(session('2026-09-28', [reps])), AT)).toBeNull()
  })

  it('uses the best of several attempts', () => {
    const attempts = logOf(SPINTA, DIP_MAX, [done(18), done(22), done(20), open(30)], { kind: 'attempts' })
    const r = resolvePercentMax(dipPctEx, byDate(session('2026-10-01', [attempts])), AT)
    expect(r).toMatchObject({ base: 22, min: 13, max: 13 })
  })

  it('computes min and max reps for a percentage range', () => {
    const range: Exercise = { ...dipPctEx, target_min: 60, target_max: 70, dose: '3 × 60-70% del max' }
    expect(resolvePercentMax(range, byDate(withMax('2026-10-01', 20)), AT)).toEqual({
      min: 12,
      max: 14,
      base: 20,
      baseDate: '2026-10-01',
      pctMin: 60,
      pctMax: 70,
      sides: null,
    })
  })

  it('uses the other percentage when one is null', () => {
    const onlyMax: Exercise = { ...dipPctEx, target_min: null, target_max: 70 }
    expect(resolvePercentMax(onlyMax, byDate(withMax('2026-10-01', 20)), AT)).toMatchObject({ min: 14, max: 14, pctMin: 70, pctMax: 70 })
    const onlyMin: Exercise = { ...dipPctEx, target_min: 50, target_max: null }
    expect(resolvePercentMax(onlyMin, byDate(withMax('2026-10-01', 20)), AT)).toMatchObject({ min: 10, max: 10, pctMin: 50, pctMax: 50 })
  })

  it('is null without percentages or for other units', () => {
    const sessions = byDate(withMax('2026-10-01', 20))
    expect(resolvePercentMax({ ...dipPctEx, target_min: null, target_max: null }, sessions, AT)).toBeNull()
    expect(resolvePercentMax(SPINTA.exercises[7], sessions, { date: SPINTA.date, index: 7 })).toBeNull()
  })

  it('reads results stored in old sessions even after the plan changed (log copies)', () => {
    const oldPlanLog: ExerciseLog = {
      index: 0,
      key: 'dip',
      name: 'Dip test (vecchia scheda)',
      kind: 'max',
      unit: 'rep',
      measure: 'rep',
      test: true,
      perSide: false,
      setsPlanned: 1,
      sets: [done(16)],
    }
    const sessions = byDate(session('2026-09-20', [oldPlanLog], { planId: 'vecchia' }))
    expect(resolvePercentMax(dipPctEx, sessions, AT)).toMatchObject({ base: 16, baseDate: '2026-09-20', max: 10 })
  })
})

describe('resolvePercentMax — per_side', () => {
  const GAMBE = plan.days[2]
  const PISTOL = 4
  /** A later per_side exercise "pistol squat 3 × 60% del max" (no such exercise in the fixture yet). */
  const pistolPct: Exercise = {
    ...GAMBE.exercises[5],
    key: 'pistol-squat',
    name: 'Pistol squat',
    kind: 'reps',
    unit: '%max',
    target_min: 60,
    target_max: 60,
    per_side: true,
  }
  const LATER = { date: '2026-10-10', index: 0 }
  const pistolMax = (set: SetLog) => byDate(session(GAMBE.date, [logOf(GAMBE, PISTOL, [set])]))

  it('gives each side a target from its own max; the top level is the weaker side', () => {
    expect(GAMBE.exercises[PISTOL]).toMatchObject({ key: 'pistol-squat', kind: 'max', per_side: true })
    const r = resolvePercentMax(pistolPct, pistolMax(sides(10, 5)), LATER)
    expect(r?.sides).toEqual({ dx: { min: 6, max: 6, base: 10 }, sx: { min: 3, max: 3, base: 5 } })
    expect(r).toMatchObject({ min: 3, max: 3, base: 5, baseDate: GAMBE.date })
    expect(latestResult(pistolMax(sides(10, 5)), 'pistol-squat', LATER)).toEqual({
      value: 10,
      date: GAMBE.date,
      index: PISTOL,
      dx: 10,
      sx: 5,
    })
  })

  it('a side without a value uses the overall best; a recorded 0 stays 0', () => {
    const onlyDx = resolvePercentMax(pistolPct, pistolMax(sides(10, null, true, false)), LATER)
    expect(onlyDx?.sides).toEqual({ dx: { min: 6, max: 6, base: 10 }, sx: { min: 6, max: 6, base: 10 } })
    const zero = resolvePercentMax(pistolPct, pistolMax(sides(10, 0)), LATER)
    expect(zero?.sides?.sx).toEqual({ min: 0, max: 0, base: 0 })
    expect(zero).toMatchObject({ min: 0, max: 0, base: 0 })
  })

  it('has no sides for an exercise that is not per_side, or a max not recorded per side', () => {
    const r = resolvePercentMax({ ...pistolPct, per_side: false }, pistolMax(sides(10, 5)), LATER)
    expect(r).toMatchObject({ min: 6, max: 6, base: 10, sides: null })
    const flat = byDate(session(GAMBE.date, [logOf(GAMBE, PISTOL, [done(8)], { perSide: false })]))
    expect(resolvePercentMax(pistolPct, flat, LATER)).toMatchObject({ min: 5, max: 5, base: 8, sides: null })
  })
})

describe('latestResult', () => {
  it('returns the greatest (date, index) among earlier results', () => {
    const a = logOf(SPINTA, 2, [done(10)], { key: 'dip', kind: 'max' })
    const b = logOf(SPINTA, 4, [done(12)], { key: 'dip', kind: 'max' })
    const sessions = byDate(session('2026-10-01', [a, b]), withMax('2026-09-24', 25))
    expect(latestResult(sessions, 'dip', AT)).toEqual({ value: 12, date: '2026-10-01', index: 4, dx: null, sx: null })
    expect(latestResult(sessions, 'dip', { date: '2026-10-01', index: 4 })).toEqual({ value: 10, date: '2026-10-01', index: 2, dx: null, sx: null })
    expect(latestResult(sessions, 'dip', { date: '2026-10-01', index: 0 })).toEqual({ value: 25, date: '2026-09-24', index: DIP_MAX, dx: null, sx: null })
    expect(latestResult(sessions, 'dip')).toEqual({ value: 12, date: '2026-10-01', index: 4, dx: null, sx: null })
  })

  it('skips logs without recorded values and other keys', () => {
    const empty = logOf(SPINTA, DIP_MAX, [open(), open()])
    const other = logOf(SPINTA, 2, [done(40)])
    const sessions = byDate(withMax('2026-09-24', 25), session('2026-10-01', [empty, other]))
    expect(latestResult(sessions, 'dip', AT)).toEqual({ value: 25, date: '2026-09-24', index: DIP_MAX, dx: null, sx: null })
    expect(latestResult(sessions, 'verticale-muro', AT)).toEqual({ value: 40, date: '2026-10-01', index: 2, dx: null, sx: null })
    expect(latestResult(sessions, 'muscle-up', AT)).toBeNull()
  })
})

describe('lowerIsBetter', () => {
  it('is true only for pain scores (and timed sprint tests)', () => {
    expect(lowerIsBetter(null, '0-10')).toBe(true)
    expect(lowerIsBetter('s', '0-10')).toBe(true)
    expect(lowerIsBetter('s', 's')).toBe(false)
    expect(lowerIsBetter('rep', 'rep')).toBe(false)
    expect(lowerIsBetter('cm', 'cm')).toBe(false)
    expect(lowerIsBetter('m', null)).toBe(false)
    expect(lowerIsBetter(null, null)).toBe(false)
    // "Sprint 30 m da fermo ... Più basso è meglio" (fixture library key test-30m).
    expect(lowerIsBetter('s', 's', 'test-30m')).toBe(true)
    expect(lowerIsBetter('s', 's', 'front-lever')).toBe(false)
  })
})

describe('isSetDone / setsDone / recordedValues', () => {
  it('uses `done` for normal sets', () => {
    expect(isSetDone(done(5), false)).toBe(true)
    expect(isSetDone(done(null), false)).toBe(true)
    expect(isSetDone(open(5), false)).toBe(false)
  })

  it('needs both sides for per_side sets', () => {
    expect(isSetDone(sides(5, 4), true)).toBe(true)
    expect(isSetDone(sides(5, null, true, false), true)).toBe(false)
    expect(isSetDone(sides(null, 4, false, true), true)).toBe(false)
    expect(isSetDone(done(5), true)).toBe(false)
  })

  it('counts only done sets', () => {
    const GAMBE = plan.days[2]
    expect(setsDone(undefined)).toBe(0)
    expect(setsDone(logOf(SPINTA, 9, [done(12), open(10), done(15), done(null)]))).toBe(3)
    expect(setsDone(logOf(GAMBE, 5, [sides(8, 8), sides(8, null, true, false), sides(7, 7)]))).toBe(2)
    expect(setsDone(logOf(SPINTA, 9, []))).toBe(0)
  })

  it('collects numeric values of done sets (per side: each done side)', () => {
    const GAMBE = plan.days[2]
    expect(recordedValues(logOf(SPINTA, 3, [done(5), open(9), done(null), done(12)]))).toEqual([5, 12])
    expect(recordedValues(logOf(GAMBE, 4, [sides(5, 4)]))).toEqual([5, 4])
    expect(recordedValues(logOf(GAMBE, 4, [sides(5, 4, true, false)]))).toEqual([5])
  })
})

describe('bestResult', () => {
  const GAMBE = plan.days[2]

  it('picks the maximum and its set index', () => {
    const r = bestResult(logOf(GAMBE, 1, [done(200), done(215), open(260), done(210)]))
    expect(r).toEqual({ best: 215, dx: null, sx: null, bestSetIndex: 1 })
  })

  it('keeps the first set on ties', () => {
    expect(bestResult(logOf(SPINTA, 3, [done(9), done(12), done(12)])).bestSetIndex).toBe(1)
  })

  it('picks the minimum for 0-10 pain scores', () => {
    const TIRATA = plan.days[1]
    const check = logOf(TIRATA, 0, [done(5), done(3), done(4)])
    expect(check.measure).toBe('0-10')
    expect(bestResult(check)).toEqual({ best: 3, dx: null, sx: null, bestSetIndex: 1 })
    expect(bestResult(logOf(TIRATA, 0, [done(0)])).best).toBe(0)
  })

  it('picks the minimum for the timed sprint test', () => {
    const sprint: ExerciseLog = { ...logOf(GAMBE, 1, [done(4.6), done(4.42), done(4.5)]), key: 'test-30m', unit: 's', measure: 's' }
    expect(bestResult(sprint)).toMatchObject({ best: 4.42, bestSetIndex: 1 })
  })

  it('reports per-side bests', () => {
    const pistol = logOf(GAMBE, 4, [sides(5, 4)])
    expect(pistol.perSide).toBe(true)
    expect(bestResult(pistol)).toEqual({ best: 5, dx: 5, sx: 4, bestSetIndex: 0 })
    const multi = logOf(GAMBE, 4, [sides(3, 6), sides(5, 4), sides(7, null, true, false)])
    expect(bestResult(multi)).toEqual({ best: 7, dx: 7, sx: 6, bestSetIndex: 2 })
  })

  it('is empty without a log or values', () => {
    const empty = { best: null, dx: null, sx: null, bestSetIndex: -1 }
    expect(bestResult(undefined)).toEqual(empty)
    expect(bestResult(logOf(SPINTA, DIP_MAX, []))).toEqual(empty)
    expect(bestResult(logOf(SPINTA, DIP_MAX, [open(20), done(null)]))).toEqual(empty)
  })
})
