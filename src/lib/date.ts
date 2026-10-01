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

/** UTC calendar date of an ISO day (null if malformed or not a real date). */
function parseISO(iso: string): Date | null {
  const m = ISO_DATE.exec(iso)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo - 1, d))
  // Reject overflowing dates such as 2026-02-30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
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

/** Current timestamp as ISO string (wrapper to ease testing). */
export function nowISO(): string {
  return new Date().toISOString()
}
