import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan, type Plan } from '../plan/schema'
import { dateRange, formatLongDate, pickDefaultDay, weekOffset } from './date'
import { currentExample, shiftPlanWeeks } from './examplePlan'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

const example = loadPlan()

function notes(plan: Plan): string[] {
  return plan.days.flatMap((d) => d.exercises.map((e) => e.note ?? ''))
}

describe('currentExample', () => {
  it('returns the same plan inside the week of the example (1-4 Oct 2026)', () => {
    expect(currentExample(example, '2026-09-28')).toBe(example)
    expect(currentExample(example, '2026-10-01')).toBe(example)
    expect(currentExample(example, '2026-10-04')).toBe(example)
  })

  it('moves the days onto the current week, keeping their weekday', () => {
    const plan = currentExample(example, '2026-10-13')
    expect(plan.days.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    for (const day of plan.days) {
      expect(formatLongDate(day.date).split(' ')[0]).toBe(day.weekday?.toLowerCase())
    }
  })

  it('moves id, start, end, period and next check-in with the days', () => {
    const plan = currentExample(example, '2026-10-13')
    expect(plan.id).toBe('2026-10-15')
    expect(plan.start).toBe('2026-10-15')
    expect(plan.end).toBe('2026-10-18')
    expect(plan.period).toBe('gio 15 - dom 18 ottobre 2026')
    expect(plan.next_checkin).toBe('domenica 18 ottobre, verso le 9:45')
  })

  it('moves the dates written in the exercise notes, not the pain scores', () => {
    const plan = currentExample(example, '2026-10-13')
    const text = notes(plan).join('\n')
    expect(text).toContain('il test dei puliti è lunedì 19/10')
    expect(text).toContain('Il 30 m cronometrato è sabato 31/10')
    expect(text).not.toContain('lunedì 5/10')
    expect(text).toContain('Dolore massimo 3/10')
  })

  it('moves the dates of the tests written with their weekday', () => {
    const when = currentExample(example, '2026-10-13').tests.map((t) => t.when)
    expect(when).toContain('lun 19/10')
    expect(when).toContain('sab 31/10')
    expect(when).not.toContain('lun 5/10')
    // "1/10" has no weekday to check it against: it stays as written.
    expect(when[0]).toBe('1/10')
  })

  it('keeps when the plan was generated and everything else', () => {
    const plan = currentExample(example, '2026-10-13')
    expect(plan.generated_at).toBe(example.generated_at)
    expect(plan.library).toBe(example.library)
    expect(plan.elbow).toBe(example.elbow)
    expect(plan.days[1].exercises.map((e) => e.key)).toEqual(example.days[1].exercises.map((e) => e.key))
  })

  it('stays a valid plan', () => {
    const r = parsePlan(JSON.parse(JSON.stringify(currentExample(example, '2026-10-13'))))
    expect(r.ok).toBe(true)
  })

  it('also moves backwards and across the new year', () => {
    expect(currentExample(example, '2026-09-20').days[0].date).toBe('2026-09-17')
    const plan = currentExample(example, '2027-01-01')
    expect(plan.days.map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(plan.period).toBe('gio 31 dicembre 2026 - dom 3 gennaio 2027')
  })

  it('never opens as an ended plan: every day of two years opens on a day of the current week', () => {
    for (const today of dateRange('2026-10-01', '2028-12-31')) {
      const { days } = currentExample(example, today)
      const pick = pickDefaultDay(days, today)
      const date = pick && days[pick.index].date
      expect(pick?.reason, today).not.toBe('past')
      expect(date && weekOffset(date, today), today).toBe(0)
    }
  })

  it('re-aligning a stored example gives the same plan as loading it again', () => {
    const stored = currentExample(example, '2026-10-13')
    expect(currentExample(stored, '2026-10-14')).toBe(stored)
    expect(currentExample(stored, '2026-11-03')).toEqual(currentExample(example, '2026-11-03'))
  })

  it('moving a stored example week after week, across new year, matches loading it again', () => {
    let stored = example
    const mondays = dateRange('2026-10-05', '2028-12-31').filter((_, i) => i % 7 === 0)
    for (const today of mondays) {
      stored = currentExample(stored, today)
      expect(stored, today).toEqual(currentExample(example, today))
    }
  })
})

describe('shiftPlanWeeks', () => {
  it('returns the same plan for 0 weeks', () => {
    expect(shiftPlanWeeks(example, 0)).toBe(example)
  })

  it('writes the period from the days when the plan has no start and end', () => {
    const plan = shiftPlanWeeks({ ...example, start: null, end: null }, 2)
    expect(plan.start).toBeNull()
    expect(plan.end).toBeNull()
    expect(plan.period).toBe('gio 15 - dom 18 ottobre 2026')
  })

  it('adds no period to a plan without one', () => {
    expect(shiftPlanWeeks({ ...example, period: null }, 2).period).toBeNull()
  })

  it('keeps an id that is not a date', () => {
    expect(shiftPlanWeeks({ ...example, id: 'demo' }, 2).id).toBe('demo')
  })
})
