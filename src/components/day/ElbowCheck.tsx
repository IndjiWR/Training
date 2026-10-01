import { useId, useState } from 'react'
import type { Exercise, Plan } from '../../plan/schema'
import { elbowLevel, stopRule } from '../../lib/elbow'
import { unlockAudio } from '../../lib/feedback'
import { formatValue, toSeconds } from '../../lib/format'
import { setElbowPre } from '../../state/actions'
import { HoldTimer } from '../timers/HoldTimer'
import { IconCheck } from '../icons'
import { ScoreGrid } from '../ui'
import { hasText } from './dayUtils'
import { LevelLegend, LevelPreview, StopRule } from './ElbowParts'
import './day.css'

export interface ElbowCheckProps {
  date: string
  plan: Plan
  /** The check-gomito exercise of the day (null if the day lacks it, shouldn't happen). */
  checkEx: Exercise | null
  /** Opens the elbow sheet (manual traffic light). */
  onManual: () => void
}

/**
 * Gate shown before anything else on days with check-gomito: STOP rule, optional 10" active
 * hang, 0-10 pain score with live traffic-light preview. Confirming stores the score (which also
 * starts the session) and unlocks the exercises.
 */
export function ElbowCheck({ date, plan, checkEx, onManual }: ElbowCheckProps) {
  const titleId = useId()
  const [score, setScore] = useState<number | null>(null)
  const [hangSeconds, setHangSeconds] = useState<number | null>(null)

  const stop = stopRule(plan.elbow)
  const level = score == null ? null : elbowLevel(score, plan.elbow)
  const unit = checkEx?.unit ?? null
  const targetMin = checkEx ? toSeconds(checkEx.target_min, unit) : null
  const targetMax = checkEx ? toSeconds(checkEx.target_max, unit) : null

  const confirm = () => {
    if (score == null) return
    unlockAudio()
    setElbowPre(date, score)
  }

  return (
    <section className="card dy-gate" aria-labelledby={titleId}>
      <div className="dy-gate__intro">
        <h2 id={titleId}>Prima di tutto: check del gomito</h2>
        <p className="small muted">Gli esercizi si sbloccano dopo il voto.</p>
      </div>

      {stop && <StopRule text={stop} />}

      {checkEx && (
        <div className="stack-sm">
          <div className="dy-step__title">
            <h3>{checkEx.name}</h3>
            {hasText(checkEx.dose) && <span className="badge">{checkEx.dose}</span>}
          </div>
          {hasText(checkEx.note) && <p className="small muted">{checkEx.note}</p>}
        </div>
      )}

      <div className="dy-step">
        <p className="dy-step__title">
          <strong>1 · Sospensione attiva</strong>
          <span className="small muted">facoltativa</span>
        </p>
        {hangSeconds == null ? (
          <HoldTimer
            id={`${date}#elbow-check`}
            targetMin={targetMin}
            targetMax={targetMax}
            prepSeconds={3}
            onStop={setHangSeconds}
            label="Sospensione attiva"
          />
        ) : (
          <div className="row">
            <p className="dy-hang-done">
              <IconCheck />
              Sospensione fatta: <span className="num">{formatValue(hangSeconds, 's')}</span>
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => setHangSeconds(null)}>
              Rifai
            </button>
          </div>
        )}
      </div>

      <div className="dy-step">
        <p className="dy-step__title">
          <strong>2 · Dolore al gomito</strong>
          <span className="small muted">0 = nessuno · 10 = massimo</span>
        </p>
        <ScoreGrid
          label="Dolore al gomito, da 0 a 10"
          value={score}
          onChange={setScore}
          levelFor={(n) => elbowLevel(n, plan.elbow)}
        />
        <LevelLegend elbow={plan.elbow} />
        {level && <LevelPreview score={score} level={level} elbow={plan.elbow} />}
      </div>

      <div className="stack-sm">
        <button
          type="button"
          className="btn btn--big btn--primary btn--block"
          disabled={score == null}
          onClick={confirm}
        >
          {score == null ? 'Scegli un voto' : `Conferma voto ${score}/10`}
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={onManual}>
          Imposta il semaforo a mano
        </button>
      </div>
    </section>
  )
}
