import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan, type Plan } from '../plan/schema'
import type { PlanSource, SessionLog } from './types'
import { setElbowPre, setPlan, updateSet } from './actions'
import { ACTIVE_SESSION_MS, keepExampleCurrent, loadExamplePlan, openSessionStart } from './planSync'
import { __setStateForTests, defaultData, getState } from './store'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

function session(date: string, patch: Partial<SessionLog> = {}): SessionLog {
  return {
    date,
    planId: 'p',
    dayType: 'SPINTA',
    dayTitle: null,
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

describe('openSessionStart', () => {
  it('is null without an open session', () => {
    expect(openSessionStart({})).toBeNull()
    expect(
      openSessionStart({
        '2026-09-29': session('2026-09-29'),
        '2026-09-30': session('2026-09-30', {
          startedAt: '2026-09-30T16:00:00.000Z',
          finishedAt: '2026-09-30T17:00:00.000Z',
        }),
        '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z', skipped: true }),
        '2026-10-02': session('2026-10-02', { startedAt: 'non una data' }),
      }),
    ).toBeNull()
  })

  it('returns the latest start among started, unfinished, not skipped sessions', () => {
    const sessions = {
      '2026-09-24': session('2026-09-24', { startedAt: '2026-09-24T16:00:00.000Z' }),
      '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z' }),
      '2026-10-02': session('2026-10-02', { startedAt: '2026-10-02T16:00:00.000Z', skipped: true }),
    }
    expect(openSessionStart(sessions)).toBe(Date.parse('2026-10-01T16:00:00.000Z'))
  })

  it('pairs with ACTIVE_SESSION_MS: a forgotten session stops counting after 3 h', () => {
    const start = openSessionStart({ '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z' }) })
    expect(start).not.toBeNull()
    expect(ACTIVE_SESSION_MS).toBe(3 * 60 * 60_000)
    const inProgress = (now: number) => start != null && now - start < ACTIVE_SESSION_MS
    expect(inProgress(Date.parse('2026-10-01T18:59:59.000Z'))).toBe(true)
    expect(inProgress(Date.parse('2026-10-01T19:00:00.000Z'))).toBe(false)
  })
})

describe('example plan on the current week', () => {
  const example = loadPlan()

  function stored(plan: Plan, source: PlanSource): void {
    const data = defaultData()
    __setStateForTests({ ...data, plan, planMeta: { ...data.planMeta, source } })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    // Tuesday 13 October 2026, 12:00 in Rome: the example (1-4 Oct) is two weeks old.
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    __setStateForTests(defaultData())
  })

  it('loadExamplePlan loads the example onto the current week', async () => {
    __setStateForTests(defaultData())
    await loadExamplePlan()
    const { plan, planMeta } = getState()
    expect(planMeta.source).toBe('example')
    expect(plan?.days.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
  })

  it('keepExampleCurrent moves a stored example of past weeks onto the current week', () => {
    stored(example, 'example')
    keepExampleCurrent()
    const { plan, planMeta } = getState()
    expect(planMeta.source).toBe('example')
    expect(plan?.start).toBe('2026-10-15')
  })

  it('keepExampleCurrent keeps when the example was received and the last sync error', () => {
    stored(example, 'example')
    const meta = { ...getState().planMeta, receivedAt: '2026-10-01T15:00:00.000Z', lastError: 'Script non raggiungibile' }
    __setStateForTests({ ...getState(), planMeta: meta })
    keepExampleCurrent()
    expect(getState().plan?.start).toBe('2026-10-15')
    expect(getState().planMeta).toEqual(meta)
  })

  it('keepExampleCurrent leaves an example already on the current week as it is', () => {
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'))
    stored(example, 'example')
    const before = getState()
    keepExampleCurrent()
    expect(getState()).toBe(before)
  })

  it('trying the example and going back to the real plan keeps the logs of the current week', async () => {
    // A real plan on the current week whose Friday lists its exercises in another order and has
    // an exercise (L-sit) the example does not have on that day.
    const friday = example.days[1]
    const lSit = example.days[0].exercises.find((e) => e.key === 'l-sit')
    if (!lSit) throw new Error('l-sit is missing from the fixture')
    const real: Plan = {
      ...example,
      id: 'reale',
      days: example.days.map((d, i) => ({
        ...d,
        date: ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'][i],
        exercises: d === friday ? [...d.exercises, lSit].reverse() : d.exercises,
      })),
    }
    const index = (key: string) => real.days[1].exercises.findIndex((e) => e.key === key)
    stored(real, 'remote')
    setElbowPre('2026-10-16', 2)
    updateSet('2026-10-16', index('rematore-anelli'), 0, { done: true, value: 12 })
    updateSet('2026-10-16', index('l-sit'), 0, { done: true, value: 15 })
    const logged = getState().sessions['2026-10-16']

    await loadExamplePlan()
    const onExample = Object.keys(getState().sessions['2026-10-16'].exercises)
    expect(onExample.filter((id) => id.startsWith('orphan:'))).toHaveLength(1)
    setPlan(real, 'remote')
    expect(getState().sessions['2026-10-16']).toEqual(logged)
  })

  it('keepExampleCurrent never touches a plan from Drive or from a file', () => {
    for (const source of ['remote', 'file'] as const) {
      stored(example, source)
      const before = getState()
      keepExampleCurrent()
      expect(getState()).toBe(before)
    }
  })
})
