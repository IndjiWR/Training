import { useCallback, useState } from 'react'
import type { Elbow } from '../../plan/schema'
import { unlockAudio } from '../../lib/feedback'
import { markSkipped, reopenSession, startSession } from '../../state/actions'
import type { SessionLog } from '../../state/types'
import { IconCheck, IconPlay, IconStop } from '../icons'
import type { SessionProgress } from './dayUtils'
import { FinishSheet } from './FinishSheet'
import './day.css'

/* ───────────────────────── status line (top) ───────────────────────── */

export interface SessionStatusProps {
  session: SessionLog | undefined
  progress: SessionProgress
  /** Screen wake lock currently held. */
  wakeLocked: boolean
}

/** One line under the header: "Sessione in corso · Serie 5/24 · Schermo sempre acceso" / "Sessione chiusa ✓". */
export function SessionStatus({ session, progress, wakeLocked }: SessionStatusProps) {
  if (!session?.startedAt) return null
  if (session.finishedAt) {
    return (
      <p className="dy-status">
        <span className="dy-status__done">Sessione chiusa ✓</span>
      </p>
    )
  }
  return (
    <p className="dy-status" role="status">
      <span className="dy-status__live">Sessione in corso</span>
      <span className="num">
        Serie {progress.done}/{progress.planned}
      </span>
      {wakeLocked && <span className="dy-status__wake tiny">Schermo sempre acceso</span>}
    </p>
  )
}

/* ───────────────────────── start / skip (top) ───────────────────────── */

export interface SessionStartProps {
  date: string
  session: SessionLog | undefined
  /** Elbow check pending: the gate starts the session, only "skip" is offered here. */
  elbowPending: boolean
}

/**
 * "Inizia sessione" + "Segna come saltata", or the skipped banner with "Annulla". A session started
 * after the skip mark is being trained: the mark is stale and the banner is not shown.
 */
export function SessionStart({ date, session, elbowPending }: SessionStartProps) {
  if (session?.skipped && !session.startedAt && !session.finishedAt) {
    return (
      <div className="banner banner--warn dy-skipped" role="status">
        <p>Sessione segnata come saltata.</p>
        <button type="button" className="btn btn--outline" onClick={() => markSkipped(date, false)}>
          Annulla
        </button>
      </div>
    )
  }
  if (session?.startedAt) return null
  return (
    <div className="stack-sm">
      {!elbowPending && (
        <button
          type="button"
          className="btn btn--big btn--primary btn--block"
          onClick={() => {
            unlockAudio()
            startSession(date)
          }}
        >
          <IconPlay />
          Inizia sessione
        </button>
      )}
      <button type="button" className="btn btn--ghost btn--block" onClick={() => markSkipped(date, true)}>
        Segna come saltata
      </button>
    </div>
  )
}

/* ───────────────────────── progress / finish (bottom) ───────────────────────── */

export interface SessionPanelProps {
  date: string
  session: SessionLog | undefined
  progress: SessionProgress
  elbow: Elbow | null
}

/** Started: progress + "Termina sessione". Finished: summary card with "Modifica" / "Riapri". */
export function SessionPanel({ date, session, progress, elbow }: SessionPanelProps) {
  const [sheet, setSheet] = useState<'finish' | 'edit' | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])

  if (!session?.startedAt) return null

  const finished = Boolean(session.finishedAt)
  const pct = progress.planned > 0 ? Math.min(100, Math.round((progress.done / progress.planned) * 100)) : 0
  const meta = [
    session.rpe != null ? `RPE ${session.rpe}` : null,
    session.elbowDuring != null ? `gomito durante ${session.elbowDuring}/10` : null,
  ].filter(Boolean)

  return (
    <>
      {finished ? (
        <section className="card dy-panel" aria-label="Sessione chiusa">
          <h2 className="dy-done-title">
            <IconCheck />
            Sessione chiusa
          </h2>
          <p className="num">
            Serie {progress.done}/{progress.planned}
            {meta.length > 0 && ` · ${meta.join(' · ')}`}
          </p>
          {session.notes && <p className="small muted pre-line">{session.notes}</p>}
          <div className="dy-actions">
            <button type="button" className="btn btn--outline" onClick={() => setSheet('edit')}>
              Modifica
            </button>
            <button type="button" className="btn btn--outline" onClick={() => reopenSession(date)}>
              Riapri
            </button>
          </div>
        </section>
      ) : (
        <section className="card dy-panel" aria-label="Avanzamento della sessione">
          <p className="dy-panel__row">
            <span>Serie fatte</span>
            <span className="dy-panel__count">
              {progress.done} / {progress.planned}
            </span>
          </p>
          <div className="dy-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
          <button type="button" className="btn btn--big btn--primary btn--block" onClick={() => setSheet('finish')}>
            <IconStop />
            Termina sessione
          </button>
        </section>
      )}
      {sheet && (
        <FinishSheet
          mode={sheet}
          date={date}
          session={session}
          progress={progress}
          elbow={elbow}
          onClose={closeSheet}
        />
      )}
    </>
  )
}
