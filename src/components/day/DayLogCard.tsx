import { useId } from 'react'
import type { Elbow } from '../../plan/schema'
import { elbowLevel } from '../../lib/elbow'
import { updateDayLog } from '../../state/actions'
import { useAppData } from '../../state/store'
import { NumberField, ScoreGrid } from '../ui'
import { levelText } from './ElbowParts'
import './day.css'

export interface DayLogCardProps {
  date: string
  elbow: Elbow | null
}

/** "Diario del giorno" (every day, rest days included): morning weight, elbow next morning, sleep. */
export function DayLogCard({ date, elbow }: DayLogCardProps) {
  const titleId = useId()
  const log = useAppData((s) => s.days[date])
  const weight = log?.weightKg ?? null
  const elbowNext = log?.elbowNextMorning ?? null
  const sleep = log?.sleepH ?? null
  const nextLevel = elbowNext == null ? null : elbowLevel(elbowNext, elbow)

  return (
    <section className="card stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Diario del giorno</h2>

      <NumberField
        label="Peso al mattino"
        unit="kg"
        min={30}
        max={250}
        value={weight}
        placeholder="es. 73,5"
        onChange={(v) => updateDayLog(date, { weightKg: v })}
      />

      <div className="dy-score">
        <div className="dy-score__head">
          <h3>Gomito al risveglio (la mattina dopo)</h3>
          {elbowNext != null && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => updateDayLog(date, { elbowNextMorning: null })}
            >
              Cancella
            </button>
          )}
        </div>
        <p className="tiny muted">
          Voto 0-10 del gomito appena sveglio il giorno dopo questo: si compila domattina, riaprendo questo giorno.
        </p>
        <ScoreGrid
          label="Gomito al risveglio la mattina dopo, da 0 a 10"
          value={elbowNext}
          onChange={(n) => updateDayLog(date, { elbowNextMorning: n })}
          levelFor={(n) => elbowLevel(n, elbow)}
        />
        {nextLevel && (
          <p className="small dy-level" aria-live="polite">
            {elbowNext}/10 · {levelText(nextLevel)}
          </p>
        )}
      </div>

      <div className="stack-sm">
        <NumberField
          label="Sonno"
          unit="h"
          min={0}
          max={24}
          value={sleep}
          placeholder="es. 7,5"
          onChange={(v) => updateDayLog(date, { sleepH: v })}
        />
        <p className="tiny muted">Ore dormite la notte prima di questo giorno.</p>
      </div>
    </section>
  )
}
