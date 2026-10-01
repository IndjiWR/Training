import { TIME_ZONE } from '../../lib/date'

/** Timestamp display helpers for the shell screens (always Europe/Rome, it-IT). */

const dateTimeFmt = new Intl.DateTimeFormat('it-IT', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat('it-IT', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const relativeFmt = new Intl.RelativeTimeFormat('it', { numeric: 'auto' })

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/** "1 ott 2026, 17:33" (raw text when unparsable, "—" when missing). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = toDate(iso)
  return d ? dateTimeFmt.format(d) : iso
}

/** "1 ottobre 2026" (raw text when unparsable, "—" when missing). */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = toDate(iso)
  return d ? dateFmt.format(d) : iso
}

/** "adesso", "5 minuti fa", "ieri", "3 giorni fa"; null when missing/unparsable. */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  const d = toDate(iso)
  if (!d) return null
  const diffS = Math.round((d.getTime() - now) / 1000)
  const abs = Math.abs(diffS)
  if (abs < 45) return 'adesso'
  if (abs < 3600) return relativeFmt.format(Math.round(diffS / 60), 'minute')
  if (abs < 86400) return relativeFmt.format(Math.round(diffS / 3600), 'hour')
  if (abs < 86400 * 30) return relativeFmt.format(Math.round(diffS / 86400), 'day')
  return null
}

/** "1 ott 2026, 17:33 (2 ore fa)". */
export function formatDateTimeAgo(iso: string | null | undefined): string {
  const abs = formatDateTime(iso)
  const ago = formatAgo(iso)
  return ago ? `${abs} (${ago})` : abs
}
