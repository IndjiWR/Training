import type { Day, Exercise, Plan } from '../plan/schema'
import { addDays, formatPeriod, shiftDateMentions, weekOffset } from './date'

/**
 * The bundled example plan (scheda-corrente.json) is a real week: Thursday 1 to Sunday 4 October
 * 2026. Loaded as is, it opens as an ended plan from the following Monday on. As a demo it is
 * moved onto the current week instead, by whole weeks so that every weekday stays right.
 */

/** Earliest day of the plan (days may be unsorted). */
function firstDate(days: readonly Day[]): string {
  return days.reduce((min, d) => (d.date < min ? d.date : min), days[0].date)
}

/** Latest day of the plan. */
function lastDate(days: readonly Day[]): string {
  return days.reduce((max, d) => (d.date > max ? d.date : max), days[0].date)
}

/**
 * The plan moved by `weeks` whole weeks: the dates of its days, id (when it is a date), start, end
 * and period, and the dates written in its texts (next check-in, day titles and notes, exercise
 * names and notes, when and notes of the tests). When it was generated does not change. Same object
 * for 0 weeks.
 */
export function shiftPlanWeeks(plan: Plan, weeks: number): Plan {
  if (weeks === 0) return plan
  const near = firstDate(plan.days)
  const date = (iso: string) => addDays(iso, weeks * 7) ?? iso
  const text = (s: string) => shiftDateMentions(s, weeks, near)
  const maybeText = (s: string | null) => (s === null ? null : text(s))
  const exercise = (e: Exercise): Exercise => ({ ...e, name: text(e.name), note: maybeText(e.note) })

  const days = plan.days.map((d) => ({
    ...d,
    date: date(d.date),
    title: maybeText(d.title),
    note: maybeText(d.note),
    exercises: d.exercises.map(exercise),
  }))
  const tests = plan.tests.map((t) => ({ ...t, when: maybeText(t.when), note: maybeText(t.note) }))
  const start = plan.start === null ? null : date(plan.start)
  const end = plan.end === null ? null : date(plan.end)
  const period =
    plan.period === null ? null : (formatPeriod(start ?? firstDate(days), end ?? lastDate(days)) ?? plan.period)

  return { ...plan, id: date(plan.id), start, end, period, next_checkin: maybeText(plan.next_checkin), days, tests }
}

/** The example plan on the week of `today` (YYYY-MM-DD, Europe/Rome); the same object when already there. */
export function currentExample(plan: Plan, today: string): Plan {
  return shiftPlanWeeks(plan, weekOffset(firstDate(plan.days), today) ?? 0)
}
