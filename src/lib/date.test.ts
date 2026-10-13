import { afterEach, describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Day, Plan } from '../plan/schema'
import {
  addDays,
  dateRange,
  formatLongDate,
  formatPeriod,
  formatShortDate,
  pickDefaultDay,
  shiftDateMentions,
  todayISO,
  weekOffset,
} from './date'

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

describe('addDays', () => {
  it('moves forwards and backwards across months, years and DST changes', () => {
    expect(addDays('2026-10-01', 14)).toBe('2026-10-15')
    expect(addDays('2026-10-15', -14)).toBe('2026-10-01')
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 3)).toBe('2027-01-03')
    expect(addDays('2026-10-01', 0)).toBe('2026-10-01')
  })

  it('is null for a malformed or impossible date', () => {
    expect(addDays('boh', 1)).toBeNull()
    expect(addDays('2026-02-30', 7)).toBeNull()
  })
})

describe('weekOffset (Monday-Sunday weeks)', () => {
  it('is 0 inside the same week', () => {
    expect(weekOffset('2026-10-01', '2026-10-04')).toBe(0)
    expect(weekOffset('2026-10-04', '2026-09-28')).toBe(0)
  })

  it('counts whole weeks, the week changing on Monday', () => {
    expect(weekOffset('2026-10-01', '2026-10-11')).toBe(1)
    expect(weekOffset('2026-10-01', '2026-10-12')).toBe(2)
    expect(weekOffset('2026-10-01', '2026-10-13')).toBe(2)
    expect(weekOffset('2026-10-01', '2027-01-01')).toBe(13)
  })

  it('is negative when the second date is in an earlier week', () => {
    expect(weekOffset('2026-10-01', '2026-09-20')).toBe(-2)
  })

  it('is null when a date is malformed', () => {
    expect(weekOffset('boh', '2026-10-01')).toBeNull()
    expect(weekOffset('2026-10-01', '2026-13-01')).toBeNull()
  })
})

describe('formatPeriod', () => {
  it('writes month and year once when the period shares them (the style of the plan)', () => {
    expect(formatPeriod('2026-10-01', '2026-10-04')).toBe(loadPlan().period)
    expect(formatPeriod('2026-10-15', '2026-10-18')).toBe('gio 15 - dom 18 ottobre 2026')
  })

  it('writes both months, or both years, when the period crosses them', () => {
    expect(formatPeriod('2026-10-29', '2026-11-01')).toBe('gio 29 ottobre - dom 1 novembre 2026')
    expect(formatPeriod('2026-12-31', '2027-01-03')).toBe('gio 31 dicembre 2026 - dom 3 gennaio 2027')
  })

  it('is null when a date is malformed', () => {
    expect(formatPeriod('boh', '2026-10-04')).toBeNull()
  })
})

describe('shiftDateMentions', () => {
  const near = '2026-10-01'

  it('moves weekday + day/month mentions by whole weeks', () => {
    expect(shiftDateMentions('Il test dei puliti è lunedì 5/10.', 2, near)).toBe('Il test dei puliti è lunedì 19/10.')
    expect(shiftDateMentions('Il 30 m cronometrato è sabato 17/10.', 2, near)).toBe('Il 30 m cronometrato è sabato 31/10.')
    expect(shiftDateMentions('gio 1/10, ven 2/10', 2, near)).toBe('gio 15/10, ven 16/10')
    expect(shiftDateMentions('Lunedì 19/10', -2, near)).toBe('Lunedì 5/10')
  })

  it('moves weekday + day + month name mentions, with their year when written', () => {
    expect(shiftDateMentions('domenica 4 ottobre, verso le 9:45', 2, near)).toBe('domenica 18 ottobre, verso le 9:45')
    expect(shiftDateMentions('dom 4 ottobre 2026', 13, near)).toBe('dom 3 gennaio 2027')
    expect(shiftDateMentions('dom 4 ottobre 9:45', 2, near)).toBe('dom 18 ottobre 9:45')
  })

  it('leaves alone a month name followed by a two-digit year', () => {
    expect(shiftDateMentions('giovedì 1 ottobre 26', 2, near)).toBe('giovedì 1 ottobre 26')
  })

  it('moves a day/month/year mention with its year, and leaves a two-digit year alone', () => {
    expect(shiftDateMentions('giovedì 31/12/2026', 13, near)).toBe('giovedì 1/4/2027')
    expect(shiftDateMentions('lunedì 5/10/26', 2, near)).toBe('lunedì 5/10/26')
  })

  it('reads a date without year in the year closest to `near`', () => {
    expect(shiftDateMentions('domenica 27/12', 1, '2026-12-24')).toBe('domenica 3/1')
    expect(shiftDateMentions('sabato 2/1', 1, '2026-12-31')).toBe('sabato 9/1')
  })

  it('leaves alone what is not a date: scores out of 10 and weekdays that do not match', () => {
    const rules = 'Dolore massimo 3/10 e deve calare. Dolore ≤3/10, poi 4-5/10.'
    expect(shiftDateMentions(rules, 2, near)).toBe(rules)
    expect(shiftDateMentions('lunedì 6/10', 2, near)).toBe('lunedì 6/10')
    expect(shiftDateMentions('verso le 9:45', 2, near)).toBe('verso le 9:45')
  })

  it('returns the text unchanged for 0 weeks', () => {
    expect(shiftDateMentions('lunedì 5/10', 0, near)).toBe('lunedì 5/10')
  })
})
