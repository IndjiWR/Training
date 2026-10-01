import { useMemo } from 'react'
import { formatShortDate } from '../../lib/date'
import { formatNumberIt } from '../../lib/format'
import { resolvePercentMax, type PercentMaxTarget } from '../../lib/results'
import type { Exercise } from '../../plan/schema'
import { useAppData } from '../../state/store'

/** %max target of an exercise (null when not %max or no max recorded yet). Reactive to new results. */
export function usePercentMax(ex: Exercise, date: string, index: number): PercentMaxTarget | null {
  const sessions = useAppData((s) => s.sessions)
  const isPct = ex.unit === '%max'
  return useMemo(
    () => (isPct ? resolvePercentMax(ex, sessions, { date, index }) : null),
    [isPct, ex, sessions, date, index],
  )
}

function span(min: number, max: number, suffix = ''): string {
  return min === max ? `${formatNumberIt(min)}${suffix}` : `${formatNumberIt(min)}–${formatNumberIt(max)}${suffix}`
}

export interface PercentMaxInfoProps {
  ex: Exercise
  pm: PercentMaxTarget | null
  /** Unit label of the result ("rip", "s"). */
  unit: string
}

/**
 * "60% del max (20 rip, gio 1/10) = 12 rip" (per side when the sides differ: "60% del max
 * (dx 10 · sx 5 rip, sab 3/10) = dx 6 · sx 3 rip"), or the plan text + hint when no max exists yet.
 */
export function PercentMaxInfo({ ex, pm, unit }: PercentMaxInfoProps) {
  const sides = pm?.sides && pm.sides.dx.base !== pm.sides.sx.base ? pm.sides : null
  if (pm && sides) {
    return (
      <p className="ex-target">
        {span(pm.pctMin, pm.pctMax, '%')} del max (dx {formatNumberIt(sides.dx.base)} · sx{' '}
        {formatNumberIt(sides.sx.base)} {unit}, {formatShortDate(pm.baseDate)}) ={' '}
        <strong className="num">
          dx {span(sides.dx.min, sides.dx.max)} · sx {span(sides.sx.min, sides.sx.max)} {unit}
        </strong>
      </p>
    )
  }
  if (pm) {
    return (
      <p className="ex-target">
        {span(pm.pctMin, pm.pctMax, '%')} del max ({formatNumberIt(pm.base)} {unit}, {formatShortDate(pm.baseDate)}) ={' '}
        <strong className="num">
          {span(pm.min, pm.max)} {unit}
        </strong>
      </p>
    )
  }
  return (
    <div className="banner banner--info ex-pct-missing">
      {ex.dose && <p className="ex-target">{ex.dose}</p>}
      <p className="small">Registra prima il massimale di questo esercizio</p>
    </div>
  )
}
