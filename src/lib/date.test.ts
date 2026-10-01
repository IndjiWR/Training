import { afterEach, describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Day, Plan } from '../plan/schema'
import { dateRange, formatLongDate, formatShortDate, pickDefaultDay, todayISO } from './date'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

/** Device time zone switch for the TZ-independence checks (Node honours runtime TZ changes). */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const originalTZ = env.TZ

afterEach(() => {
  if (originalTZ === undefined) delete env.TZ
  else env.TZ = originalTZ
})

describe('todayISO (Europe/Rome)', () => {
  it('switches day at midnight Rome time, not UTC', () => {
    expect(todayISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01')
    expect(todayISO(new Date('2026-10-01T21:59:00Z'))).toBe('2026-10-01')
    expect(todayISO(new Date('2026-10-01T22:00:00Z'))).toBe('2026-10-02')
  })

  it('handles the end of daylight saving time', () => {
    // 2026-10-25: CEST -> CET at 01:00 UTC.
    expect(todayISO(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25')
    expect(todayISO(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25')
    expect(todayISO(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26')
  })

  it('handles winter time (UTC+1)', () => {
    expect(todayISO(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31')
    expect(todayISO(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01')
  })

  it('ignores the device time zone', () => {
    env.TZ = 'Pacific/Kiritimati' // UTC+14
    expect(todayISO(new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-01')
    env.TZ = 'America/Los_Angeles' // UTC-7
    expect(todayISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01')
  })

  it('defaults to the current instant', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('pickDefaultDay', () => {
  const plan = loadPlan()
  const days = plan.days

  it('picks the day of today', () => {
    expect(pickDefaultDay(days, '2026-10-01')).toEqual({ index: 0, reason: 'today' })
    expect(pickDefaultDay(days, '2026-10-03')).toEqual({ index: 2, reason: 'today' })
    expect(pickDefaultDay(days, '2026-10-04')).toEqual({ index: 3, reason: 'today' })
  })

  it('picks the next upcoming day when today is not in the plan', () => {
    const gap: Day[] = [days[0], days[2]] // 1/10 and 3/10
    expect(pickDefaultDay(gap, '2026-10-02')).toEqual({ index: 1, reason: 'upcoming' })
  })

  it('picks the first day when the plan has not started yet', () => {
    expect(pickDefaultDay(days, '2026-09-28')).toEqual({ index: 0, reason: 'upcoming' })
  })

  it('picks the last day when the plan is over', () => {
    expect(pickDefaultDay(days, '2026-10-05')).toEqual({ index: 3, reason: 'past' })
    expect(pickDefaultDay(days, '2027-01-10')).toEqual({ index: 3, reason: 'past' })
  })

  it('handles unsorted days (nearest future / latest past, by date not position)', () => {
    const unsorted: Day[] = [days[3], days[1], days[2], days[0]] // 4, 2, 3, 1
    expect(pickDefaultDay(unsorted, '2026-09-30')).toEqual({ index: 3, reason: 'upcoming' })
    expect(pickDefaultDay(unsorted, '2026-10-02')).toEqual({ index: 1, reason: 'today' })
    expect(pickDefaultDay(unsorted, '2026-10-10')).toEqual({ index: 0, reason: 'past' })
    const gap: Day[] = [days[3], days[0]] // 4, 1
    expect(pickDefaultDay(gap, '2026-10-02')).toEqual({ index: 0, reason: 'upcoming' })
  })

  it('returns null for an empty list', () => {
    expect(pickDefaultDay([], '2026-10-01')).toBeNull()
  })
})

describe('formatShortDate / formatLongDate', () => {
  it('formats the short Italian date', () => {
    expect(formatShortDate('2026-10-01')).toBe('gio 1/10')
    expect(formatShortDate('2026-10-04')).toBe('dom 4/10')
    expect(formatShortDate('2026-10-05')).toBe('lun 5/10')
    expect(formatShortDate('2027-01-09')).toBe('sab 9/1')
  })

  it('formats the long Italian date', () => {
    expect(formatLongDate('2026-10-01')).toBe('giovedì 1 ottobre')
    expect(formatLongDate('2026-10-04')).toBe('domenica 4 ottobre')
    expect(formatLongDate('2026-03-02')).toBe('lunedì 2 marzo')
    expect(formatLongDate('2026-08-15')).toBe('sabato 15 agosto')
  })

  it('does not depend on the device time zone', () => {
    env.TZ = 'America/Los_Angeles'
    expect(formatShortDate('2026-10-01')).toBe('gio 1/10')
    expect(formatLongDate('2026-10-01')).toBe('giovedì 1 ottobre')
    env.TZ = 'Pacific/Kiritimati'
    expect(formatShortDate('2026-10-01')).toBe('gio 1/10')
  })

  it('returns malformed input unchanged', () => {
    expect(formatShortDate('ieri')).toBe('ieri')
    expect(formatLongDate('')).toBe('')
  })
})

describe('dateRange', () => {
  it('is inclusive on both ends', () => {
    expect(dateRange('2026-10-01', '2026-10-04')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(dateRange('2026-10-01', '2026-10-01')).toEqual(['2026-10-01'])
  })

  it('crosses months, years and DST changes', () => {
    expect(dateRange('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
    expect(dateRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(dateRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('is empty when end < start or input is malformed', () => {
    expect(dateRange('2026-10-04', '2026-10-01')).toEqual([])
    expect(dateRange('boh', '2026-10-01')).toEqual([])
  })
})
