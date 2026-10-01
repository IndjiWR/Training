import type { Unit } from '../plan/schema'

/** 75 -> "1:15", 3725 -> "1:02:05". Negative/NaN -> "0:00". */
export function formatClock(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** Rest notation used by the plan: 90 -> 90", 120 -> 2', 150 -> 2'30". */
export function formatRest(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s >= 60 && s % 60 === 0) return `${s / 60}'`
  if (s < 120) return `${s}"`
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`
}

/** "2'" or "2'–3'" (range only when max > min). */
export function formatRestRange(min: number, max: number | null | undefined): string {
  return max != null && max > min ? `${formatRest(min)}–${formatRest(max)}` : formatRest(min)
}

/** Italian number: 73.25 -> "73,3" (decimals = 1). Integers stay integers. */
export function formatNumberIt(n: number, decimals = 1): string {
  const f = 10 ** decimals
  return String(Math.round(n * f) / f).replace('.', ',')
}

/** Short Italian label for a unit or a library measure. */
export function unitLabel(unit: Unit | string | null | undefined): string {
  switch (unit) {
    case 'rep':
      return 'rip'
    case 's':
      return 's'
    case 'min':
      return 'min'
    case 'm':
      return 'm'
    case 'cm':
      return 'cm'
    case '%max':
      return '% max'
    case '0-10':
      return '/10'
    default:
      return unit ?? ''
  }
}

/** Value with unit: (12,'rep') -> "12 rip", (4,'0-10') -> "4/10", (35,'s') -> "35 s". */
export function formatValue(value: number, unit: Unit | string | null | undefined): string {
  const v = formatNumberIt(value)
  if (unit === '0-10') return `${v}/10`
  const u = unitLabel(unit)
  return u ? `${v} ${u}` : v
}

/** Converts a plan target to seconds (min -> ×60, s -> as is). Null for other units. */
export function toSeconds(value: number | null, unit: Unit | null): number | null {
  if (value == null) return null
  if (unit === 'min') return Math.round(value * 60)
  if (unit === 's') return Math.round(value)
  return null
}
