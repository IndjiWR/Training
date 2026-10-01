import { useId } from 'react'
import type { Elbow } from '../../plan/schema'
import { formatShortDate } from '../../lib/date'
import { elbowLevel } from '../../lib/elbow'
import { updateDayLog } from '../../state/actions'
import { useAppData } from '../../state/store'
import { IconChevronRight } from '../icons'
import { NumberField, ScoreGrid } from '../ui'
import { previousDate } from './dayUtils'
import { levelText } from './ElbowParts'
import './day.css'

export interface DayLogCardProps {
  date: string
  elbow: Elbow | null
}

/**
 * "Diario del giorno" (every day, rest days included), all about this day's morning: weight, elbow
 * on waking (stored as the previous day's "elbow next morning", so it is entered on the day the
 * user opens), sleep of the night before. The elbow next morning of this day itself stays
 * available in a collapsed section.
 */
export function DayLogCard({ date, elbow }: DayLogCardProps) {
  const titleId = useId()
  const prev = previousDate(date)
  const log = useAppData((s) => s.days[date])
  const prevLog = useAppData((s) => (prev ? s.days[prev] : undefined))
  const weight = log?.weightKg ?? null
  const sleep = log?.sleepH ?? null
  const elbowThisMorning = prevLog?.elbowNextMorning ?? null
  const elbowNext = log?.elbowNextMorning ?? null

  return (
    <section className="card stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Diario del giorno</h2>

      <NumberField
        label="Peso stamattina"
        unit="kg"
        min={30}
        max={250}
        value={weight}
        placeholder="es. 73,5"
        onChange={(v) => updateDayLog(date, { weightKg: v })}
      />

      {prev && (
        <ElbowMorningScore
          title={`Gomito stamattina (dopo ${formatShortDate(prev)})`}
          hint="Voto 0-10 del gomito appena sveglio: dice come ha reagito al giorno prima."
          gridLabel="Gomito stamattina al risveglio, da 0 a 10"
          value={elbowThisMorning}
          elbow={elbow}
          onChange={(n) => updateDayLog(prev, { elbowNextMorning: n })}
        />
      )}

      <div className="stack-sm">
        <NumberField
          label="Sonno stanotte"
          unit="h"
          min={0}
          max={24}
          value={sleep}
          placeholder="es. 7,5"
          onChange={(v) => updateDayLog(date, { sleepH: v })}
        />
        <p className="tiny muted">Ore dormite la notte prima di questo giorno.</p>
      </div>

      <details className="dy-details">
        <summary>
          <IconChevronRight />
          Gomito la mattina dopo{elbowNext != null && <span className="num"> · {elbowNext}/10</span>}
        </summary>
        <div className="dy-details__body">
          <ElbowMorningScore
            hint="Di solito si compila domattina, da «Gomito stamattina» del giorno dopo."
            gridLabel="Gomito al risveglio la mattina dopo, da 0 a 10"
            value={elbowNext}
            elbow={elbow}
            onChange={(n) => updateDayLog(date, { elbowNextMorning: n })}
          />
        </div>
      </details>
    </section>
  )
}

interface ElbowMorningScoreProps {
  /** Heading; omitted inside the collapsed section (its summary is the heading). */
  title?: string
  hint: string
  gridLabel: string
  value: number | null
  elbow: Elbow | null
  onChange: (value: number | null) => void
}

/** 0-10 elbow score on waking with "Cancella" and the resulting traffic light. */
function ElbowMorningScore({ title, hint, gridLabel, value, elbow, onChange }: ElbowMorningScoreProps) {
  const level = value == null ? null : elbowLevel(value, elbow)
  const clear =
    value != null ? (
      <button type="button" className="btn btn--ghost" onClick={() => onChange(null)}>
        Cancella
      </button>
    ) : null

  return (
    <div className="dy-score">
      {title ? (
        <div className="dy-score__head">
          <h3>{title}</h3>
          {clear}
        </div>
      ) : (
        clear && <div className="dy-score__head">{clear}</div>
      )}
      <p className="tiny muted">{hint}</p>
      <ScoreGrid label={gridLabel} value={value} onChange={onChange} levelFor={(n) => elbowLevel(n, elbow)} />
      {level && (
        <p className="small dy-level" aria-live="polite">
          {value}/10 · {levelText(level)}
        </p>
      )}
    </div>
  )
}
