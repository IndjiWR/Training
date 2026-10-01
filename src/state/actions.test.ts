import { beforeEach, describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Plan } from '../plan/schema'
import { latestResult, resolvePercentMax } from '../lib/results'
import { computeWeekSummary } from '../lib/summary'
import {
  finishSession,
  markSkipped,
  ORPHAN_PREFIX,
  remapSession,
  replaceAllData,
  setElbowOverride,
  setElbowPre,
  setExerciseText,
  setPlan,
  startSession,
  updateSet,
} from './actions'
import { __setStateForTests, defaultData, getState } from './store'
import type { SessionLog } from './types'

type PlanJson = { generated_at: string; days: { date: string; exercises: Record<string, unknown>[] }[] }

function loadPlan(json: unknown): Plan {
  const r = parsePlan(json)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

/** Fixture copy edited by `edit` (a newer revision of the same week). */
function variant(edit: (json: PlanJson) => void): Plan {
  const json = JSON.parse(JSON.stringify(fixture)) as PlanJson
  json.generated_at = '2026-10-01T18:00+02:00'
  edit(json)
  return loadPlan(json)
}

const plan = loadPlan(fixture)
const SPINTA = '2026-10-01'
const TIRATA = '2026-10-02'
const RIPOSO = '2026-10-04'

const session = (date: string): SessionLog => getState().sessions[date]
const exercises = (date: string) => session(date).exercises

function reset(p: Plan = plan): void {
  __setStateForTests({ ...defaultData(), plan: p })
}

beforeEach(() => reset())

describe('skipped mark', () => {
  it('a real start clears it, so a trained day is not reported as "saltata"', () => {
    markSkipped(SPINTA, true)
    expect(session(SPINTA)).toMatchObject({ skipped: true, startedAt: null })

    updateSet(SPINTA, 0, 0, { done: true, value: 600 })
    expect(session(SPINTA).skipped).toBe(false)
    expect(session(SPINTA).startedAt).not.toBeNull()

    finishSession(SPINTA, { rpe: 7, elbowDuring: null, notes: '' })
    expect(session(SPINTA)).toMatchObject({ skipped: false, rpe: 7 })
    expect(session(SPINTA).finishedAt).not.toBeNull()

    const row = computeWeekSummary({ plan, sessions: getState().sessions, days: {}, today: '2026-10-05' }).sessions.find(
      (s) => s.date === SPINTA,
    )
    expect(row?.status).not.toBe('skipped')
  })

  it('the elbow score (gate) and startSession clear it too; an untouched start keeps identity', () => {
    markSkipped(TIRATA, true)
    setElbowPre(TIRATA, 2)
    expect(session(TIRATA).skipped).toBe(false)

    markSkipped(SPINTA, true)
    startSession(SPINTA)
    expect(session(SPINTA).skipped).toBe(false)
    const startedAt = session(SPINTA).startedAt
    const before = getState()
    startSession(SPINTA)
    expect(getState()).toBe(before)
    expect(session(SPINTA).startedAt).toBe(startedAt)
  })
})

describe('setElbowOverride', () => {
  it('without a score a colour settles the check set, "Automatico" re-opens it', () => {
    setElbowOverride(TIRATA, null)
    expect(exercises(TIRATA)['0']).toBeUndefined()

    setElbowOverride(TIRATA, 'green')
    const settled = exercises(TIRATA)['0']
    expect(settled).toMatchObject({ key: 'check-gomito', setsPlanned: 1 })
    expect(settled.sets).toHaveLength(1)
    expect(settled.sets[0]).toMatchObject({ done: true, value: null })
    expect(settled.sets[0].at).toBeTruthy()
    expect(session(TIRATA).startedAt).toBeNull()

    setElbowOverride(TIRATA, 'yellow')
    expect(exercises(TIRATA)['0'].sets[0].at).toBe(settled.sets[0].at)

    setElbowOverride(TIRATA, null)
    expect(exercises(TIRATA)['0'].sets[0]).toMatchObject({ done: false, value: null, at: null })
  })

  it('with a score it only changes the level (the check keeps the score)', () => {
    setElbowPre(TIRATA, 2)
    setElbowOverride(TIRATA, 'red')
    expect(session(TIRATA).elbowOverride).toBe('red')
    expect(exercises(TIRATA)['0'].sets[0]).toMatchObject({ done: true, value: 2 })
    setElbowOverride(TIRATA, null)
    expect(exercises(TIRATA)['0'].sets[0]).toMatchObject({ done: true, value: 2 })
  })

  it('a later score overwrites the settled check', () => {
    setElbowOverride(TIRATA, 'green')
    setElbowPre(TIRATA, 4)
    expect(exercises(TIRATA)['0'].sets[0]).toMatchObject({ done: true, value: 4 })
  })

  it('days without a check are untouched', () => {
    setElbowOverride(SPINTA, 'yellow')
    expect(exercises(SPINTA)).toEqual({})
  })
})

describe('planned sets of a log', () => {
  it('sets: null on a tracked exercise counts 1 (the row the card shows); info counts 0', () => {
    reset(
      variant((j) => {
        j.days[0].exercises[0].sets = null
      }),
    )
    updateSet(SPINTA, 0, 0, { done: true, value: 600 })
    expect(exercises(SPINTA)['0'].setsPlanned).toBe(1)

    setExerciseText(RIPOSO, 0, 'camminata')
    expect(exercises(RIPOSO)['0'].setsPlanned).toBe(0)
  })
})

describe('setPlan with logs on the dates it covers', () => {
  it('keeps the sessions untouched when the exercises did not move', () => {
    updateSet(SPINTA, 5, 0, { done: true, value: 20 })
    const before = getState().sessions
    setPlan(loadPlan(fixture), 'remote')
    expect(getState().sessions).toBe(before)
  })

  it('follows an exercise removed before the logged ones', () => {
    updateSet(SPINTA, 4, 0, { done: true, value: 480 }) // verticale-libera (time)
    updateSet(SPINTA, 5, 0, { done: true, value: 20 }) // dip (max)
    const v2 = variant((j) => {
      j.days[0].exercises.splice(1, 1) // pirouette removed
    })
    setPlan(v2, 'remote')

    expect(exercises(SPINTA)['3']).toMatchObject({ key: 'verticale-libera', kind: 'time', index: 3 })
    expect(exercises(SPINTA)['4']).toMatchObject({ key: 'dip', kind: 'max', index: 4 })
    expect(exercises(SPINTA)['5']).toBeUndefined()
    const dip60 = v2.days[0].exercises[5]
    expect(dip60.unit).toBe('%max')
    expect(resolvePercentMax(dip60, getState().sessions, { date: SPINTA, index: 5 })?.base).toBe(20)
  })

  it('follows an exercise inserted before the logged ones, so new results never land in the old log', () => {
    updateSet(SPINTA, 5, 0, { done: true, value: 20 })
    setPlan(
      variant((j) => {
        j.days[0].exercises.splice(5, 0, { ...j.days[0].exercises[7] }) // pike-push-up before the dips
      }),
      'remote',
    )
    expect(exercises(SPINTA)['6']).toMatchObject({ key: 'dip', kind: 'max', index: 6 })
    expect(exercises(SPINTA)['5']).toBeUndefined()

    updateSet(SPINTA, 5, 0, { done: true, value: 8 })
    updateSet(SPINTA, 5, 1, { done: true, value: 30 })
    expect(exercises(SPINTA)['5']).toMatchObject({ key: 'pike-push-up', kind: 'reps' })
    expect(exercises(SPINTA)['6'].sets.map((s) => s.value)).toEqual([20])
    expect(latestResult(getState().sessions, 'dip')?.value).toBe(20)
  })

  it('follows swapped exercises', () => {
    updateSet(SPINTA, 7, 0, { done: true, value: 7 }) // pike-push-up
    updateSet(SPINTA, 8, 0, { done: true, value: 14 }) // piegamenti-parallettes
    setPlan(
      variant((j) => {
        const ex = j.days[0].exercises
        ;[ex[7], ex[8]] = [ex[8], ex[7]]
      }),
      'remote',
    )
    expect(exercises(SPINTA)['7']).toMatchObject({ key: 'piegamenti-parallettes', index: 7 })
    expect(exercises(SPINTA)['8']).toMatchObject({ key: 'pike-push-up', index: 8 })
  })

  it('keeps a log whose exercise is gone aside (history only) and re-attaches it if it comes back', () => {
    updateSet(SPINTA, 1, 0, { done: true, value: 2 }) // pirouette
    const v2 = variant((j) => {
      j.days[0].exercises.splice(1, 1)
    })
    setPlan(v2, 'remote')
    expect(exercises(SPINTA)['1']).toBeUndefined()
    expect(exercises(SPINTA)[`${ORPHAN_PREFIX}1`]).toMatchObject({ key: 'pirouette', index: 1, setsPlanned: 3 })

    // Another orphan from the same slot gets its own id.
    updateSet(SPINTA, 1, 0, { done: true, value: 50 }) // verticale-muro (now index 1)
    setPlan(
      variant((j) => {
        j.days[0].exercises.splice(1, 2)
      }),
      'remote',
    )
    expect(exercises(SPINTA)[`${ORPHAN_PREFIX}1`].key).toBe('pirouette')
    expect(exercises(SPINTA)[`${ORPHAN_PREFIX}1~2`].key).toBe('verticale-muro')

    setPlan(loadPlan(fixture), 'remote')
    expect(exercises(SPINTA)['1']).toMatchObject({ key: 'pirouette', index: 1 })
    expect(exercises(SPINTA)['2']).toMatchObject({ key: 'verticale-muro', index: 2 })
    expect(Object.keys(exercises(SPINTA)).some((id) => id.startsWith(ORPHAN_PREFIX))).toBe(false)
  })

  it('prefers the least displacement among repeated exercises (sparse logs)', () => {
    const dup = variant((j) => {
      j.days[0].exercises.splice(9, 0, { ...j.days[0].exercises[6] }) // dip %max at 6 and 9
    })
    reset(dup)
    updateSet(SPINTA, 9, 0, { done: true, value: 12 })
    const before = getState().sessions
    setPlan(dup, 'remote')
    expect(getState().sessions).toBe(before)

    const s = session(SPINTA)
    const day = loadPlan(
      (() => {
        const j = JSON.parse(JSON.stringify(fixture)) as PlanJson
        j.days[0].exercises.splice(9, 0, { ...j.days[0].exercises[6] })
        j.days[0].exercises.splice(1, 1)
        return j
      })(),
    ).days[0]
    const moved = remapSession(s, day)
    expect(moved.exercises['8']).toMatchObject({ key: 'dip', index: 8 })
    expect(moved.exercises['5']).toBeUndefined()
  })

  it('re-syncs setsPlanned with the new plan', () => {
    updateSet(SPINTA, 9, 0, { done: true, value: 12 }) // l-sit 4 sets
    expect(exercises(SPINTA)['9'].setsPlanned).toBe(4)
    setPlan(
      variant((j) => {
        j.days[0].exercises[9].sets = 5
      }),
      'remote',
    )
    expect(exercises(SPINTA)['9'].setsPlanned).toBe(5)
  })

  it('replaceAllData re-aligns imported logs onto the imported plan', () => {
    updateSet(SPINTA, 5, 0, { done: true, value: 20 })
    const v2 = variant((j) => {
      j.days[0].exercises.splice(1, 1)
    })
    replaceAllData({ ...getState(), plan: v2 })
    expect(exercises(SPINTA)['4']).toMatchObject({ key: 'dip', index: 4 })
  })
})
