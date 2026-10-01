import { useMemo } from 'react'
import type { Plan } from '../../plan/schema'
import { rulesText, type EffectiveExercise } from '../../lib/elbow'
import type { ElbowLevel, SessionLog } from '../../state/types'
import { elbowChanges, levelTone } from './dayUtils'
import { levelText } from './ElbowParts'
import './day.css'

export interface ElbowBannerProps {
  plan: Plan
  session: SessionLog | undefined
  /** Effective level (override or from the score). */
  level: ElbowLevel
  /** The day after the elbow transform. */
  effs: readonly EffectiveExercise[]
  onEdit: () => void
}

/** Traffic light of the day after the check: score, level, rule text and what changes today. */
export function ElbowBanner({ plan, session, level, effs, onEdit }: ElbowBannerProps) {
  const score = session?.elbowPre ?? null
  const manual = session?.elbowOverride != null
  const rules = rulesText(plan.elbow, level)
  const changes = useMemo(() => elbowChanges(effs), [effs])

  return (
    <section className={`banner banner--${levelTone(level)} dy-elbow`} aria-label="Semaforo del gomito">
      <div className="dy-elbow__head">
        <p className="dy-elbow__title">
          Gomito <span className="num">{score != null ? `${score}/10` : '–'}</span> · {levelText(level)}
          {manual && <span className="dy-elbow__manual"> · impostato a mano</span>}
        </p>
        <button type="button" className="btn btn--outline" onClick={onEdit}>
          Modifica
        </button>
      </div>
      {rules && <p className="small">{rules}</p>}
      {changes.length > 0 && (
        <div className="stack-sm">
          <p className="small">
            <strong>Oggi cambia:</strong>
          </p>
          <ul className="dy-changes">
            {changes.map((c) => (
              <li key={c.index}>{c.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
