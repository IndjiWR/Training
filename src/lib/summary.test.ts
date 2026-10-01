import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Day, Plan } from '../plan/schema'
import type { DayLog, ExerciseLog, SessionLog, SetLog } from '../state/types'
import { applyElbow, sessionElbowLevel } from './elbow'
import { computeWeekSummary, formatWeekSummary } from './summary'
import type { WeekSummary } from './summary'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  expect(r.ok).toBe(true)
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

/* ── builders ── */

const done = (value: number | null): SetLog => ({ done: true, value })
const open = (value: number | null = null): SetLog => ({ done: false, value })
const sides = (dx: number, sx: number): SetLog => ({
  done: true,
  value: null,
  dx: { done: true, value: dx },
  sx: { done: true, value: sx },
})

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

function emptySession(day: Day, patch: Partial<SessionLog> = {}): SessionLog {
  return {
    date: day.date,
    planId: plan.id,
    dayType: day.type,
    dayTitle: day.title,
    startedAt: `${day.date}T07:00:00.000Z`,
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

/**
 * Session where every visible planned set (after the elbow transform of `patch`) is done.
 * `values` overrides the sets of specific exercise indexes.
 */
function fullSession(day: Day, patch: Partial<SessionLog> = {}, values: Record<number, SetLog[]> = {}): SessionLog {
  const s = emptySession(day, patch)
  const level = sessionElbowLevel(s, plan.elbow)
  for (const e of applyElbow(day, plan.library, level)) {
    if (e.hidden || e.ex.kind === 'info') continue
    const sets = values[e.index] ?? Array.from({ length: e.sets ?? 0 }, () => (e.ex.per_side ? sides(8, 8) : done(10)))
    s.exercises[String(e.index)] = logOf(day, e.index, sets, { setsPlanned: e.sets ?? 0 })
  }
  return s
}

const byDate = (...list: SessionLog[]): Record<string, SessionLog> => Object.fromEntries(list.map((s) => [s.date, s]))
const dayLog = (date: string, patch: Partial<DayLog>): DayLog => ({ date, weightKg: null, elbowNextMorning: null, sleepH: null, ...patch })
const daysByDate = (...list: DayLog[]): Record<string, DayLog> => Object.fromEntries(list.map((d) => [d.date, d]))

/* ── the reference week ── */

const spintaDone = fullSession(
  SPINTA,
  { rpe: 7, elbowDuring: 2, notes: '  Polsi ok, verticale meglio del previsto.  ', finishedAt: '2026-10-01T09:10:00.000Z' },
  {
    2: [done(35)], // verticale al muro
    3: [done(5), done(8), done(12), done(10), done(9), done(11)], // verticale libera
    5: [done(20)], // dip max
  },
)

/** Yellow TIRATA (elbowPre 4): partially done. */
const tirataPartial: SessionLog = {
  ...emptySession(TIRATA, { elbowPre: 4, elbowDuring: 4, rpe: 6, notes: 'Gomito rigido nelle tenute.' }),
  exercises: {
    '0': logOf(TIRATA, 0, [done(4)]),
    '1': logOf(TIRATA, 1, [done(35), done(40), done(30)]),
    '3': logOf(TIRATA, 3, [done(4), done(6)], { text: ' adv tuck ', setsPlanned: 2 }),
    '4': logOf(TIRATA, 4, [done(8), open(8)], { setsPlanned: 2 }),
  },
}

const gambeDone = fullSession(
  GAMBE,
  { notes: '   ' },
  {
    1: [done(200), done(210), done(205)], // salto in lungo
    4: [sides(5, 4)], // pistol squat
  },
)

const weekDays = daysByDate(
  dayLog('2026-09-30', { weightKg: 80, sleepH: 3, elbowNextMorning: 9 }), // outside the plan range
  dayLog('2026-10-01', { weightKg: 73.0, sleepH: 7 }),
  dayLog('2026-10-02', { weightKg: 73.4, sleepH: 8, elbowNextMorning: 5 }),
  dayLog('2026-10-03', { weightKg: 72.8, elbowNextMorning: 3 }),
  dayLog('2026-10-04', { sleepH: 7.5 }),
  dayLog('2026-10-05', { weightKg: 60, sleepH: 12, elbowNextMorning: 10 }), // outside
)

const summaryOf = (sessions: Record<string, SessionLog>, today: string, days: Record<string, DayLog> = weekDays) =>
  computeWeekSummary({ plan, sessions, days, today })

const sessionOf = (s: WeekSummary, date: string) => {
  const r = s.sessions.find((x) => x.date === date)
  if (!r) throw new Error(`missing session ${date}`)
  return r
}

/* ── tests ── */

describe('computeWeekSummary — planned sets on the fixture', () => {
  it('counts the planned sets of every day', () => {
    const s = summaryOf({}, '2026-09-30')
    expect(s.sessions.map((x) => [x.date, x.type, x.setsPlanned, x.status])).toEqual([
      ['2026-10-01', 'SPINTA', 27, 'planned'],
      ['2026-10-02', 'TIRATA', 25, 'planned'],
      ['2026-10-03', 'GAMBE', 18, 'planned'],
      ['2026-10-04', 'RIPOSO', 0, 'rest'],
    ])
    expect(s.counts).toEqual({ done: 0, partial: 0, skipped: 0, planned: 3 })
  })

  it('applies the elbow transform of the session (TIRATA 25 / 19 / 15)', () => {
    const planned = (patch: Partial<SessionLog>) =>
      sessionOf(summaryOf(byDate(emptySession(TIRATA, patch)), '2026-10-02'), '2026-10-02').setsPlanned
    expect(planned({})).toBe(25)
    expect(planned({ elbowPre: 2 })).toBe(25)
    expect(planned({ elbowPre: 4 })).toBe(19)
    expect(planned({ elbowPre: 5 })).toBe(19)
    expect(planned({ elbowPre: 6 })).toBe(15)
    expect(planned({ elbowPre: 2, elbowOverride: 'red' })).toBe(15)
    expect(planned({ elbowPre: 8, elbowOverride: 'green' })).toBe(25)
  })

  it('reports the session elbow level', () => {
    const s = summaryOf(byDate(emptySession(TIRATA, { elbowPre: 4 })), '2026-10-02')
    expect(sessionOf(s, '2026-10-02')).toMatchObject({ elbowPre: 4, elbowLevel: 'yellow' })
    expect(sessionOf(s, '2026-10-01').elbowLevel).toBeNull()
  })
})

describe('computeWeekSummary — status', () => {
  it('done / partial / skipped / rest', () => {
    const s = summaryOf(byDate(spintaDone, tirataPartial), '2026-10-04')
    expect(sessionOf(s, '2026-10-01')).toMatchObject({ status: 'done', setsDone: 27, setsPlanned: 27, rpe: 7, elbowDuring: 2 })
    expect(sessionOf(s, '2026-10-02')).toMatchObject({ status: 'partial', setsDone: 7, setsPlanned: 19, elbowPre: 4 })
    expect(sessionOf(s, '2026-10-03')).toMatchObject({ status: 'skipped', setsDone: 0, setsPlanned: 18 })
    expect(sessionOf(s, '2026-10-04')).toMatchObject({ status: 'rest', setsPlanned: 0, weekday: 'Domenica' })
    expect(s.counts).toEqual({ done: 1, partial: 1, skipped: 1, planned: 0 })
  })

  it('a training day without sets is planned today and later, skipped before today', () => {
    const s = summaryOf(byDate(spintaDone), '2026-10-02')
    expect(sessionOf(s, '2026-10-02').status).toBe('planned')
    expect(sessionOf(s, '2026-10-03').status).toBe('planned')
    const later = summaryOf(byDate(spintaDone), '2026-10-03')
    expect(sessionOf(later, '2026-10-02').status).toBe('skipped')
    expect(sessionOf(later, '2026-10-03').status).toBe('planned')
  })

  it('an empty started session counts like no session', () => {
    const s = summaryOf(byDate(emptySession(GAMBE)), '2026-10-04')
    expect(sessionOf(s, '2026-10-03').status).toBe('skipped')
    expect(sessionOf(summaryOf(byDate(emptySession(GAMBE)), '2026-10-03'), '2026-10-03').status).toBe('planned')
  })

  it('session.skipped wins over the date, but not over sets done', () => {
    const s = summaryOf(byDate({ ...spintaDone, skipped: true }, emptySession(GAMBE, { skipped: true })), '2026-09-30')
    expect(sessionOf(s, '2026-10-01')).toMatchObject({ status: 'done', setsDone: 27, setsPlanned: 27 })
    expect(sessionOf(s, '2026-10-03').status).toBe('skipped')
    const half = { ...emptySession(SPINTA, { skipped: true }), exercises: { '0': spintaDone.exercises['0'] } }
    expect(sessionOf(summaryOf(byDate(half), '2026-10-04'), '2026-10-01')).toMatchObject({ status: 'partial', setsDone: 1 })
  })

  it('a yellow TIRATA with every visible set done is done (19/19)', () => {
    const full = fullSession(TIRATA, { elbowPre: 4 }, { 0: [done(4)] })
    const s = summaryOf(byDate(full), '2026-10-04')
    expect(sessionOf(s, '2026-10-02')).toMatchObject({ status: 'done', setsDone: 19, setsPlanned: 19 })
  })

  it('extra sets count in setsDone', () => {
    const extra = fullSession(TIRATA, { elbowPre: 1 }, { 3: [done(4), done(5), done(6), done(7)] })
    const s = summaryOf(byDate(extra), '2026-10-04')
    expect(sessionOf(s, '2026-10-02')).toMatchObject({ status: 'done', setsDone: 26, setsPlanned: 25 })
  })

  it('sets of exercises hidden by a later elbow change do not count', () => {
    for (const patch of [{ elbowPre: 2, elbowOverride: 'red' as const }, { elbowPre: 7 }]) {
      const s = emptySession(TIRATA, patch)
      s.exercises['0'] = logOf(TIRATA, 0, [done(2)])
      s.exercises['1'] = logOf(TIRATA, 1, [done(30), done(30), done(30)])
      s.exercises['2'] = logOf(TIRATA, 2, [done(300)])
      s.exercises['3'] = logOf(TIRATA, 3, [done(4), done(5), done(6)])
      s.exercises['4'] = logOf(TIRATA, 4, [done(4), done(5), done(6)])
      s.exercises['5'] = logOf(TIRATA, 5, [done(3), done(3), done(3), done(3)])
      const sum = summaryOf(byDate(s), '2026-10-04')
      expect(sessionOf(sum, '2026-10-02')).toMatchObject({ status: 'partial', setsDone: 5, setsPlanned: 15, setsHiddenDone: 10 })
      expect(formatWeekSummary(sum)).toMatch(/ven 2\/10 .*parziale · serie 5\/15 \+ 10 nascoste per il gomito/)
    }
  })

  it('work done only on exercises hidden afterwards is partial, not skipped', () => {
    const s = emptySession(TIRATA, { elbowPre: 2, elbowOverride: 'red' })
    s.exercises['5'] = logOf(TIRATA, 5, [done(3), done(3)])
    // The elbow check is settled (score given): 1 of 15.
    expect(sessionOf(summaryOf(byDate(s), '2026-10-04'), '2026-10-02')).toMatchObject({
      status: 'partial',
      setsDone: 1,
      setsPlanned: 15,
      setsHiddenDone: 2,
    })
  })

  it('optional exercises (block "Opzionale") are outside the planned sets', () => {
    expect(GAMBE.exercises[8]).toMatchObject({ key: 'camminata-salita', block: 'Opzionale' })
    const noWalk = { ...gambeDone, exercises: { ...gambeDone.exercises } }
    delete noWalk.exercises['8']
    const s = summaryOf(byDate(noWalk), '2026-10-04')
    expect(sessionOf(s, '2026-10-03')).toMatchObject({ status: 'done', setsDone: 18, setsPlanned: 18, setsOptionalDone: 0 })
    expect(formatWeekSummary(s)).toMatch(/sab 3\/10 · GAMBE — fatta · serie 18\/18(\n| ·)/)
    const withWalk = summaryOf(byDate(gambeDone), '2026-10-04')
    expect(sessionOf(withWalk, '2026-10-03')).toMatchObject({ status: 'done', setsDone: 18, setsPlanned: 18, setsOptionalDone: 1 })
    const onlyWalk = { ...emptySession(GAMBE), exercises: { '8': gambeDone.exercises['8'] } }
    expect(sessionOf(summaryOf(byDate(onlyWalk), '2026-10-04'), '2026-10-03')).toMatchObject({
      status: 'partial',
      setsDone: 0,
      setsOptionalDone: 1,
    })
  })

  it('a tracked exercise with sets null counts 1 planned set', () => {
    const pike = 7
    expect(SPINTA.exercises[pike]).toMatchObject({ kind: 'reps', sets: 3 })
    const days = plan.days.map((d) =>
      d.date === SPINTA.date ? { ...d, exercises: d.exercises.map((e, i) => (i === pike ? { ...e, sets: null } : e)) } : d,
    )
    const r = computeWeekSummary({ plan: { ...plan, days }, sessions: {}, days: {}, today: '2026-09-30' })
    expect(sessionOf(r, '2026-10-01').setsPlanned).toBe(27 - 3 + 1)
  })

  it('a manual traffic light without a score settles the elbow check', () => {
    const noCheck = (patch: Partial<SessionLog>) => {
      const s = fullSession(TIRATA, patch)
      delete s.exercises['0']
      return sessionOf(summaryOf(byDate(s), '2026-10-04'), '2026-10-02')
    }
    expect(noCheck({ elbowOverride: 'green' })).toMatchObject({ status: 'done', setsDone: 25, setsPlanned: 25 })
    // Gate still pending (no score, no colour): the check is a planned set not done.
    expect(noCheck({})).toMatchObject({ status: 'partial', setsDone: 24, setsPlanned: 25 })
    // The check set stored as done without a value (manual colour) counts once and has no result.
    const stored = fullSession(TIRATA, { elbowOverride: 'yellow' }, { 0: [done(null)] })
    const r = summaryOf(byDate(stored), '2026-10-04')
    expect(sessionOf(r, '2026-10-02')).toMatchObject({ status: 'done', setsDone: 19, setsPlanned: 19 })
    expect(r.tests.find((t) => t.key === 'check-gomito')).toMatchObject({ value: null, recorded: false })
  })
})

describe('computeWeekSummary — tests, elbow, weight, sleep, notes', () => {
  const s = summaryOf(byDate(gambeDone, tirataPartial, spintaDone), '2026-10-04')

  it('lists every test exercise in plan order with its result', () => {
    expect(s.tests.map((t) => [t.date, t.key])).toEqual([
      ['2026-10-01', 'verticale-muro'],
      ['2026-10-01', 'verticale-libera'],
      ['2026-10-01', 'dip'],
      ['2026-10-02', 'check-gomito'],
      ['2026-10-02', 'front-lever'],
      ['2026-10-03', 'salto-in-lungo'],
      ['2026-10-03', 'pistol-squat'],
    ])
    const [muro, libera, dip, check, fl, salto, pistol] = s.tests
    expect(muro).toMatchObject({ value: 35, unit: 's', values: [35], recorded: true, text: null })
    expect(libera).toMatchObject({ value: 12, unit: 's', values: [5, 8, 12, 10, 9, 11] })
    expect(dip).toMatchObject({ value: 20, unit: 'rep', name: SPINTA.exercises[5].name })
    expect(check).toMatchObject({ value: 4, unit: '0-10', values: [4], recorded: true })
    expect(fl).toMatchObject({ value: 6, unit: 's', values: [4, 6], text: 'adv tuck', recorded: true })
    expect(salto).toMatchObject({ value: 210, unit: 'cm', values: [200, 210, 205] })
    expect(pistol).toMatchObject({ value: null, dx: 5, sx: 4, unit: 'rep', values: [5, 4], recorded: true })
    expect(s.tests.map((t) => t.label)).toEqual([
      'Verticale al muro (petto verso il muro)',
      'Verticale libera',
      'Dip massimali alle parallele',
      'Check gomito (sospensione attiva 10")',
      'Front lever',
      'Salto in lungo da fermo',
      'Pistol squat',
    ])
  })

  it('labels: check-gomito falls back to the exercise name, a blank head to the library label', () => {
    const library = { ...plan.library }
    delete library['check-gomito']
    const r = computeWeekSummary({ plan: { ...plan, library }, sessions: {}, days: {}, today: '2026-10-04' })
    expect(r.tests.find((t) => t.key === 'check-gomito')?.label).toBe(TIRATA.exercises[0].name)
    const days = plan.days.map((d) =>
      d.date === GAMBE.date ? { ...d, exercises: d.exercises.map((e, i) => (i === 1 ? { ...e, name: ': migliore di 3' } : e)) } : d,
    )
    const blank = computeWeekSummary({ plan: { ...plan, days }, sessions: {}, days: {}, today: '2026-10-04' })
    expect(blank.tests.find((t) => t.key === 'salto-in-lungo')?.label).toBe('Salto in lungo da fermo')
  })

  it('labels shared by two tests of the week get their date', () => {
    const days = plan.days.map((d) =>
      d.date === GAMBE.date ? { ...d, exercises: d.exercises.map((e, i) => (i === 7 ? { ...e, test: true } : e)) } : d,
    )
    const r = computeWeekSummary({ plan: { ...plan, days }, sessions: {}, days: {}, today: '2026-10-04' })
    expect(r.tests.filter((t) => t.key === 'verticale-libera').map((t) => t.label)).toEqual([
      'Verticale libera · gio 1/10',
      'Verticale libera · sab 3/10',
    ])
    expect(r.tests.find((t) => t.key === 'dip')?.label).toBe('Dip massimali alle parallele')
  })

  it('reads units from the log copy when the plan has changed', () => {
    const renamed = { ...gambeDone.exercises['1'], measure: 'm', unit: 'm' as const }
    const r = summaryOf(byDate({ ...gambeDone, exercises: { ...gambeDone.exercises, '1': renamed } }), '2026-10-04')
    expect(r.tests.find((t) => t.key === 'salto-in-lungo')?.unit).toBe('m')
  })

  it('finds a test log whose index shifted after a plan update (same key and kind)', () => {
    const moved = { ...spintaDone.exercises['5'], index: 12 }
    const exercises: Record<string, ExerciseLog> = { ...spintaDone.exercises, '12': moved }
    delete exercises['5']
    const r = summaryOf(byDate({ ...spintaDone, exercises }), '2026-10-04')
    expect(r.tests.find((t) => t.key === 'dip')).toMatchObject({ value: 20, recorded: true })
  })

  it('marks tests without results as not recorded', () => {
    const empty = summaryOf({}, '2026-10-04')
    expect(empty.tests).toHaveLength(7)
    for (const t of empty.tests) {
      expect(t).toMatchObject({ value: null, dx: null, sx: null, values: [], text: null, recorded: false })
    }
  })

  it('uses elbowPre for check-gomito even without its exercise log', () => {
    const t = summaryOf(byDate(emptySession(TIRATA, { elbowPre: 2 })), '2026-10-04').tests.find((x) => x.key === 'check-gomito')
    expect(t).toMatchObject({ value: 2, values: [2], recorded: true })
  })

  it('takes the max elbow score of the week (pre, during, next morning)', () => {
    expect(s.elbowMax).toBe(5)
    expect(s.elbowMaxLevel).toBe('yellow')
    const calm = summaryOf(byDate(spintaDone), '2026-10-04', daysByDate(dayLog('2026-10-01', { elbowNextMorning: 1 })))
    expect(calm.elbowMax).toBe(2)
    expect(calm.elbowMaxLevel).toBe('green')
    const none = summaryOf({}, '2026-10-04', {})
    expect(none.elbowMax).toBeNull()
    expect(none.elbowMaxLevel).toBeNull()
    const red = summaryOf(byDate(emptySession(TIRATA, { elbowPre: 7 })), '2026-10-04', {})
    expect(red).toMatchObject({ elbowMax: 7, elbowMaxLevel: 'red' })
  })

  it('averages weight and sleep inside the plan range only', () => {
    expect(s.weightAvg).toBeCloseTo(73.0667, 3)
    expect(s.weightCount).toBe(3)
    expect(s.sleepAvg).toBeCloseTo(7.5, 6)
    expect(s.sleepCount).toBe(3)
    const none = summaryOf({}, '2026-10-04', {})
    expect(none).toMatchObject({ weightAvg: null, weightCount: 0, sleepAvg: null, sleepCount: 0 })
  })

  it('collects non-empty notes in date order', () => {
    expect(s.notes).toEqual([
      { date: '2026-10-01', text: 'Polsi ok, verticale meglio del previsto.' },
      { date: '2026-10-02', text: 'Gomito rigido nelle tenute.' },
    ])
  })

  it('carries plan identity and range', () => {
    expect(s).toMatchObject({
      planId: '2026-10-01',
      planTitle: 'Settimana 0 - avvio e test',
      period: 'gio 1 - dom 4 ottobre 2026',
      start: '2026-10-01',
      end: '2026-10-04',
    })
  })

  it('falls back to the days range without plan.start/end', () => {
    const noRange: Plan = { ...plan, start: null, end: null }
    const r = computeWeekSummary({ plan: noRange, sessions: {}, days: weekDays, today: '2026-10-04' })
    expect(r.start).toBe('2026-10-01')
    expect(r.end).toBe('2026-10-04')
    expect(r.weightCount).toBe(3)
  })
})

describe('formatWeekSummary', () => {
  const s = summaryOf(byDate(gambeDone, tirataPartial, spintaDone), '2026-10-04')
  const text = formatWeekSummary(s)

  it('has title, period and the sections in order', () => {
    const lines = text.split('\n')
    expect(lines[0]).toContain('Settimana 0 - avvio e test')
    expect(text).toContain('gio 1 - dom 4 ottobre 2026')
    const order = ['SESSIONI', 'TEST', 'GOMITO', 'PESO E SONNO', 'NOTE'].map((h) => lines.findIndex((l) => l.startsWith(h)))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('lists the sessions with status and sets', () => {
    expect(text).toMatch(/• gio 1\/10 .*SPINTA.*fatta.*serie 27\/27/)
    expect(text).toMatch(/• ven 2\/10 .*TIRATA.*parziale.*serie 7\/19/)
    expect(text).toMatch(/• sab 3\/10 .*GAMBE.*fatta.*serie 18\/18 \+ 1 opzionale/)
    expect(text).toMatch(/• dom 4\/10 .*riposo/)
    expect(text).toContain('RPE 7')
  })

  it('lists the test results with units', () => {
    expect(text).toContain('• Dip massimali alle parallele — 20 rip')
    expect(text).toContain('• Verticale al muro (petto verso il muro) — 35 s')
    expect(text).toContain('• Salto in lungo da fermo — 210 cm (migliore di 3: 200 / 210 / 205)')
    expect(text).toContain('• Front lever — adv tuck · 6 s (migliore di 2: 4 / 6)')
    expect(text).toContain('• Pistol squat — dx 5 rip · sx 4 rip')
    expect(text).toContain('20 rip')
    expect(text).toContain('35 s')
    expect(text).toContain('210 cm')
    expect(text).toContain('4/10')
    expect(text).toContain('adv tuck')
    expect(text).toMatch(/dx 5 rip.*sx 4 rip/)
    expect(text).toMatch(/12 s \(.*5 \/ 8 \/ 12 \/ 10 \/ 9 \/ 11/)
  })

  it('shows the elbow max with traffic light', () => {
    expect(text).toMatch(/gomito/i)
    expect(text).toMatch(/5\/10 🟡 giallo/)
  })

  it('shows weight and sleep averages with the Italian comma', () => {
    expect(text).toMatch(/73,1 kg \(3 /)
    expect(text).toMatch(/7,5 h \(3 /)
  })

  it('shows the notes with their day', () => {
    expect(text).toContain('Polsi ok, verticale meglio del previsto.')
    expect(text).toContain('Gomito rigido nelle tenute.')
    expect(text.indexOf('Polsi ok')).toBeLessThan(text.indexOf('Gomito rigido'))
  })

  it('uses bullet lines', () => {
    const bullets = text.split('\n').filter((l) => l.startsWith('• '))
    expect(bullets.length).toBeGreaterThanOrEqual(4 + 7 + 1 + 2 + 2)
  })

  it('says skipped / planned in Italian', () => {
    const t = formatWeekSummary(summaryOf(byDate(spintaDone), '2026-10-03'))
    expect(t).toMatch(/ven 2\/10 .*saltata.*serie 0\/25/)
    expect(t).toMatch(/sab 3\/10 .*da fare.*serie 0\/18/)
  })

  it('writes n.d. / nessuna when data is missing', () => {
    const t = formatWeekSummary(summaryOf({}, '2026-10-01', {}))
    expect(t).toContain('• Verticale al muro (petto verso il muro) — n.d.')
    expect(t).toMatch(/GOMITO\n• Voto massimo: n\.d\./)
    expect(t).toMatch(/NOTE\n• nessuna/)
    expect(t).toMatch(/Peso medio: n\.d\./)
    expect(t).toMatch(/Sonno medio: n\.d\./)
    expect(t).toMatch(/n\.d\./)
    expect(t).toMatch(/nessuna/i)
    expect(t).not.toContain('undefined')
    expect(t).not.toContain('null')
    expect(t).not.toContain('NaN')
  })

  it('keeps one decimal for whole averages', () => {
    const t = formatWeekSummary(summaryOf({}, '2026-10-04', daysByDate(dayLog('2026-10-01', { weightKg: 73, sleepH: 8 }))))
    expect(t).toContain('73,0 kg (1 ')
    expect(t).toContain('8,0 h (1 ')
  })
})
