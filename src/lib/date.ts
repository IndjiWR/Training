import type { Day } from '../plan/schema'

export const TIME_ZONE = 'Europe/Rome'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'] as const
const WEEKDAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'] as const
const MONTHS_LONG = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const

let romeFormatter: Intl.DateTimeFormat | null = null

/** Created lazily: building an Intl formatter is comparatively expensive. */
function romeParts(now: Date): { year: string; month: string; day: string } {
  romeFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const out = { year: '', month: '', day: '' }
  for (const part of romeFormatter.formatToParts(now)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') out[part.type] = part.value
  }
  return out
}

/** Today's date YYYY-MM-DD in Europe/Rome (whatever the device time zone is). */
export function todayISO(now: Date = new Date()): string {
  const { year, month, day } = romeParts(now)
  return `${year.padStart(4, '0')}-${month}-${day}`
}

/** UTC date of day `d` of month `mo` (1-12) of year `y`; null if that day does not exist. */
function calendarDate(y: number, mo: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, mo - 1, d))
  // Reject overflowing dates such as 2026-02-30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

/** UTC calendar date of an ISO day (null if malformed or not a real date). */
function parseISO(iso: string): Date | null {
  const m = ISO_DATE.exec(iso)
  return m ? calendarDate(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

function toISO(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type DayPickReason = 'today' | 'upcoming' | 'past'

/**
 * Default day for "Oggi":
 * - the day whose date === today -> reason 'today';
 * - else the first day after today (days may be unsorted: pick the nearest future date) -> 'upcoming';
 * - else (plan entirely in the past) the latest day -> 'past'.
 * Returns null when `days` is empty.
 * ISO dates compare correctly as strings. On duplicate dates the first one in the list wins.
 */
export function pickDefaultDay(days: readonly Day[], today: string): { index: number; reason: DayPickReason } | null {
  if (days.length === 0) return null
  let upcoming = -1
  let latest = 0
  for (let i = 0; i < days.length; i++) {
    const date = days[i].date
    if (date === today) return { index: i, reason: 'today' }
    if (date > today && (upcoming < 0 || date < days[upcoming].date)) upcoming = i
    if (date > days[latest].date) latest = i
  }
  if (upcoming >= 0) return { index: upcoming, reason: 'upcoming' }
  return { index: latest, reason: 'past' }
}

/** "gio 1/10" (short weekday + d/m), computed from the ISO date (not the device TZ). Malformed -> input. */
export function formatShortDate(iso: string): string {
  const date = parseISO(iso)
  if (!date) return iso
  return `${WEEKDAYS_SHORT[date.getUTCDay()]} ${date.getUTCDate()}/${date.getUTCMonth() + 1}`
}

/** "giovedì 1 ottobre". Malformed -> input. */
export function formatLongDate(iso: string): string {
  const date = parseISO(iso)
  if (!date) return iso
  return `${WEEKDAYS_LONG[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]}`
}

/** Inclusive list of ISO dates from start to end (both YYYY-MM-DD). Empty if end < start or malformed. */
export function dateRange(start: string, end: string): string[] {
  const from = parseISO(start)
  const to = parseISO(end)
  if (!from || !to) return []
  const out: string[] = []
  // UTC days are always 24 h long, so plain millisecond steps never skip or repeat a day.
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) out.push(toISO(new Date(t)))
  return out
}

/** `iso` moved by `days` calendar days (negative: earlier); null if malformed. */
export function addDays(iso: string, days: number): string | null {
  const date = parseISO(iso)
  return date ? toISO(new Date(date.getTime() + days * DAY_MS)) : null
}

/** Epoch ms of the Monday that starts the (Monday to Sunday) week of `date`. */
function weekStart(date: Date): number {
  return date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS
}

/** Weeks (Monday to Sunday) from the week of `from` to the week of `to`: 0 = same week. Null if malformed. */
export function weekOffset(from: string, to: string): number | null {
  const a = parseISO(from)
  const b = parseISO(to)
  if (!a || !b) return null
  return Math.round((weekStart(b) - weekStart(a)) / (7 * DAY_MS))
}

/**
 * "gio 15 - dom 18 ottobre 2026", "gio 29 ottobre - dom 1 novembre 2026": month and year are
 * written once when both dates share them (the style of a plan's `period`). Malformed -> null.
 */
export function formatPeriod(start: string, end: string): string | null {
  const a = parseISO(start)
  const b = parseISO(end)
  if (!a || !b) return null
  const day = (d: Date) => `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`
  const month = (d: Date) => MONTHS_LONG[d.getUTCMonth()]
  const to = `${day(b)} ${month(b)} ${b.getUTCFullYear()}`
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${day(a)} ${month(a)} ${a.getUTCFullYear()} - ${to}`
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${day(a)} ${month(a)} - ${to}`
  return `${day(a)} - ${to}`
}

const WEEKDAY = [...WEEKDAYS_LONG, ...WEEKDAYS_SHORT].join('|')
/** "/10", "/12/2026"; not "/10/26". */
const NUMERIC_MONTH = String.raw`/(?<month>\d{1,2})(?:/(?<slashYear>\d{4}))?(?![\d/])`
/** " ottobre", " ottobre 2026"; not " ottobre 26" (a time such as " 9:45" may follow). */
const WRITTEN_MONTH =
  String.raw`(?<sepMonth>\s+)(?<monthName>${MONTHS_LONG.join('|')})(?!\p{L})` +
  String.raw`(?:(?<sepYear>\s+)(?<year>\d{4})(?!\d)|(?!\s+\d{1,3}(?![\d:])))`

/** A weekday followed by a date: "lunedì 5/10", "gio 31/12/2026", "domenica 4 ottobre", "dom 4 ottobre 2026". */
const DATE_MENTION = new RegExp(
  String.raw`(?<!\p{L})(?<weekday>${WEEKDAY})(?<sep>\s+)(?<day>\d{1,2})(?:${NUMERIC_MONTH}|${WRITTEN_MONTH})`,
  'giu',
)

interface DateMention {
  weekday: string
  sep: string
  day: string
  month?: string
  slashYear?: string
  sepMonth?: string
  monthName?: string
  sepYear?: string
  year?: string
}

/** 0 = Sunday, like getUTCDay(); -1 if `word` is not a weekday. */
function weekdayIndex(word: string): number {
  const lower = word.toLowerCase()
  const long = WEEKDAYS_LONG.findIndex((w) => w === lower)
  return long >= 0 ? long : WEEKDAYS_SHORT.findIndex((w) => w === lower)
}

/** Day `day` of month `month` (1-12) in `year`, or in the year that puts it closest to `near`. */
function mentionDate(day: number, month: number, year: number | null, near: Date): Date | null {
  const y = near.getUTCFullYear()
  const distance = (date: Date) => Math.abs(date.getTime() - near.getTime())
  let best: Date | null = null
  for (const candidate of year != null ? [year] : [y - 1, y, y + 1]) {
    const date = calendarDate(candidate, month, day)
    if (date && (!best || distance(date) < distance(best))) best = date
  }
  return best
}

/**
 * Moves the dates written with their weekday in `text` ("lunedì 5/10", "domenica 4 ottobre") by
 * `weeks` whole weeks, so the weekday stays right. A date without year is read in the year closest
 * to `near` (YYYY-MM-DD). A mention whose weekday does not match its date is left as it is: "3/10"
 * may well be a pain score. Moved dates are written without leading zeros, month names in lowercase.
 */
export function shiftDateMentions(text: string, weeks: number, near: string): string {
  const nearDate = parseISO(near)
  if (weeks === 0 || !nearDate) return text
  return text.replace(DATE_MENTION, (match: string, ...args: unknown[]) => {
    // With named groups, replace() passes the groups object as the last argument.
    const g = args[args.length - 1] as DateMention
    const month = g.monthName ? MONTHS_LONG.findIndex((m) => m === g.monthName?.toLowerCase()) + 1 : Number(g.month)
    const year = g.year ?? g.slashYear
    const date = mentionDate(Number(g.day), month, year ? Number(year) : null, nearDate)
    if (!date || date.getUTCDay() !== weekdayIndex(g.weekday)) return match
    const moved = new Date(date.getTime() + weeks * 7 * DAY_MS)
    const head = `${g.weekday}${g.sep}${moved.getUTCDate()}`
    if (!g.monthName) {
      const tail = g.slashYear ? `/${moved.getUTCFullYear()}` : ''
      return `${head}/${moved.getUTCMonth() + 1}${tail}`
    }
    const tail = g.year ? `${g.sepYear}${moved.getUTCFullYear()}` : ''
    return `${head}${g.sepMonth}${MONTHS_LONG[moved.getUTCMonth()]}${tail}`
  })
}

/** Current timestamp as ISO string (wrapper to ease testing). */
export function nowISO(): string {
  return new Date().toISOString()
}
