import type { Plan } from '../../plan/schema'
import { elbowLevel, levelEmoji, levelLabel, stopRule } from '../../lib/elbow'
import { unlockAudio } from '../../lib/feedback'
import { setElbowOverride, setElbowPre } from '../../state/actions'
import type { SessionLog } from '../../state/types'
import { ScoreGrid, Sheet } from '../ui'
import { capitalize, ELBOW_LEVELS } from './dayUtils'
import { LevelLegend, LevelPreview, levelText, StopRule } from './ElbowParts'
import './day.css'

export interface ElbowSheetProps {
  open: boolean
  /** Must be referentially stable (the Sheet re-focuses when it changes). */
  onClose: () => void
  date: string
  plan: Plan
  session: SessionLog | undefined
}

/** "Check gomito" sheet: STOP rule, re-score, manual traffic light override. */
export function ElbowSheet({ open, onClose, date, plan, session }: ElbowSheetProps) {
  const score = session?.elbowPre ?? null
  const override = session?.elbowOverride ?? null
  const auto = score == null ? null : elbowLevel(score, plan.elbow)
  const stop = stopRule(plan.elbow)

  return (
    <Sheet open={open} title="Check gomito" onClose={onClose}>
      <div className="stack">
        {stop && <StopRule text={stop} />}

        <div className="dy-score">
          <h3>Voto al gomito (0-10)</h3>
          <ScoreGrid
            label="Voto al gomito, da 0 a 10"
            value={score}
            onChange={(n) => {
              unlockAudio()
              setElbowPre(date, n)
            }}
            levelFor={(n) => elbowLevel(n, plan.elbow)}
          />
          <LevelLegend elbow={plan.elbow} />
          {auto && <LevelPreview score={score} level={auto} elbow={plan.elbow} />}
        </div>

        <div className="dy-score">
          <h3>Semaforo</h3>
          <div className="dy-chips" role="group" aria-label="Semaforo del gomito">
            <button
              type="button"
              className="chip"
              aria-pressed={override == null}
              onClick={() => setElbowOverride(date, null)}
            >
              Automatico
            </button>
            {ELBOW_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className="chip"
                aria-pressed={override === l}
                onClick={() => setElbowOverride(date, l)}
              >
                {levelEmoji(l)} {capitalize(levelLabel(l))}
              </button>
            ))}
          </div>
          <p className="small muted">
            Il semaforo decide quali esercizi vedi oggi: con il giallo gli esercizi in sospensione vengono dimezzati o
            saltati, con il rosso spariscono tutti. «Automatico» lo calcola dal voto; scegli un colore per impostarlo a
            mano.
          </p>
          {override && (
            <p className="small" aria-live="polite">
              Impostato a mano su <strong>{levelText(override)}</strong>
              {auto && auto !== override && <> (il voto indicherebbe {levelText(auto)})</>}.
            </p>
          )}
          {!override && score == null && (
            <p className="small muted">Senza voto né colore il check del gomito resta da fare.</p>
          )}
        </div>

        <button type="button" className="btn btn--big btn--primary btn--block" onClick={onClose}>
          Fatto
        </button>
      </div>
    </Sheet>
  )
}
