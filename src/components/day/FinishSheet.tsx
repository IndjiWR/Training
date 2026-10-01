import { useId, useState } from 'react'
import type { Elbow } from '../../plan/schema'
import { elbowLevel } from '../../lib/elbow'
import { finishSession, updateSessionMeta } from '../../state/actions'
import { stopRest, toast } from '../../state/ui'
import type { SessionLog } from '../../state/types'
import { ScoreGrid, Sheet } from '../ui'
import type { SessionProgress } from './dayUtils'
import { levelText } from './ElbowParts'
import './day.css'

export interface FinishSheetProps {
  /** 'finish' closes the session; 'edit' only updates RPE / elbow / notes of a closed one. */
  mode: 'finish' | 'edit'
  date: string
  session: SessionLog | undefined
  progress: SessionProgress
  elbow: Elbow | null
  /** Must be referentially stable (the Sheet re-focuses when it changes). */
  onClose: () => void
}

/** End-of-session log: RPE 1-10, elbow during 0-10, notes. Mount only while open. */
export function FinishSheet({ mode, date, session, progress, elbow, onClose }: FinishSheetProps) {
  const notesId = useId()
  const [rpe, setRpe] = useState<number | null>(session?.rpe ?? null)
  const [elbowDuring, setElbowDuring] = useState<number | null>(session?.elbowDuring ?? null)
  const [notes, setNotes] = useState(session?.notes ?? '')

  const save = () => {
    const log = { rpe, elbowDuring, notes: notes.trim() }
    if (mode === 'finish') {
      stopRest()
      finishSession(date, log)
      toast('Sessione chiusa ✓', { tone: 'success' })
    } else {
      updateSessionMeta(date, log)
      toast('Sessione aggiornata', { tone: 'success' })
    }
    onClose()
  }

  const duringLevel = elbowDuring == null ? null : elbowLevel(elbowDuring, elbow)

  return (
    <Sheet open title={mode === 'finish' ? 'Termina sessione' : 'Modifica sessione'} onClose={onClose}>
      <div className="stack">
        <p className="dy-panel__row">
          <span>Serie fatte</span>
          <span className="dy-panel__count">
            {progress.done} / {progress.planned}
          </span>
        </p>

        <div className="dy-score">
          <div className="dy-score__head">
            <h3>RPE della sessione</h3>
            {rpe != null && (
              <button type="button" className="btn btn--ghost" onClick={() => setRpe(null)}>
                Cancella
              </button>
            )}
          </div>
          <p className="tiny muted">1 = facilissima · 10 = sforzo massimo</p>
          <ScoreGrid label="RPE della sessione, da 1 a 10" min={1} max={10} value={rpe} onChange={setRpe} />
        </div>

        <div className="dy-score">
          <div className="dy-score__head">
            <h3>Gomito durante la sessione</h3>
            {elbowDuring != null && (
              <button type="button" className="btn btn--ghost" onClick={() => setElbowDuring(null)}>
                Cancella
              </button>
            )}
          </div>
          <p className="tiny muted">Dolore massimo sentito, 0 = nessuno · 10 = massimo</p>
          <ScoreGrid
            label="Gomito durante la sessione, da 0 a 10"
            value={elbowDuring}
            onChange={setElbowDuring}
            levelFor={(n) => elbowLevel(n, elbow)}
          />
          {duringLevel && (
            <p className="small dy-level" aria-live="polite">
              {elbowDuring}/10 · {levelText(duringLevel)}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={notesId}>Note</label>
          <textarea
            id={notesId}
            value={notes}
            placeholder="Com'è andata, sensazioni, cosa cambiare…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <button type="button" className="btn btn--big btn--primary btn--block" onClick={save}>
          {mode === 'finish' ? 'Salva e chiudi' : 'Salva'}
        </button>
      </div>
    </Sheet>
  )
}
