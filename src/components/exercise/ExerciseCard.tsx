import { useEffect, useId, useState } from 'react'
import type { Plan } from '../../plan/schema'
import { CHECK_KEY, elbowLevel, levelEmoji, levelLabel, type EffectiveExercise } from '../../lib/elbow'
import { formatRestRange } from '../../lib/format'
import { setsDone } from '../../lib/results'
import { addSet, removeExtraSet, resetExercise, rowCount } from '../../state/actions'
import type { ElbowLevel, ExerciseLog, SessionLog } from '../../state/types'
import { IconHome, IconMinus, IconPlus, IconReset, IconTimer } from '../icons'
import { VideoButton } from '../media/VideoButton'
import { AttemptsTracker } from './AttemptsTracker'
import { DistanceTracker } from './DistanceTracker'
import { HoldTracker } from './HoldTracker'
import { RepsTracker } from './RepsTracker'
import { TestNotes } from './TestNotes'
import { TimeTracker } from './TimeTracker'
import { clearExerciseTimers, isAttemptKind, isUntouched, type TrackerProps } from './tracker'
import { WarmupList } from './WarmupList'
import './exercise.css'

export interface ExerciseCardProps {
  /** Day date (YYYY-MM-DD) = session key. */
  date: string
  plan: Plan
  /** Exercise after the elbow transform (index = stable id in the session). */
  eff: EffectiveExercise
  session: SessionLog | undefined
  /** True while the elbow check is pending: the card is visible but not interactive. */
  locked: boolean
  /** "A casa" exercises get a tag in the header. */
  home?: boolean
}

/** One exercise, always open: header (name, dose, badges, Video) + tracker for its kind. */
export function ExerciseCard(props: ExerciseCardProps) {
  // Different component types: a plan update that changes the kind remounts cleanly.
  return props.eff.ex.kind === 'info' ? (
    <InfoCard eff={props.eff} locked={props.locked} />
  ) : (
    <TrackedCard {...props} />
  )
}

/* ───────────────────────── helpers ───────────────────────── */

/** Null for empty / placeholder ("—") plan strings. */
function clean(s: string | null | undefined): string | null {
  const v = s?.trim()
  return v && !/^[—–-]+$/.test(v) ? v : null
}

function position(eff: EffectiveExercise): number {
  return eff.ex.n ?? eff.index + 1
}

function metaLine(eff: EffectiveExercise): string | null {
  return [clean(eff.ex.dose), clean(eff.ex.block)].filter(Boolean).join(' · ') || null
}

const HIDDEN_TEXT = {
  'yellow-skip': 'Oggi si salta: gomito giallo (sessione ridotta).',
  'red-hanging': 'Oggi niente sospensioni: gomito rosso.',
} as const

const LEVEL_BANNER: Record<ElbowLevel, string> = {
  green: 'banner--ok',
  yellow: 'banner--warn',
  red: 'banner--danger',
}

function Tracker(props: TrackerProps) {
  switch (props.t.eff.ex.kind) {
    case 'reps':
      return <RepsTracker {...props} />
    case 'hold':
      return <HoldTracker {...props} />
    case 'time':
      return <TimeTracker {...props} />
    case 'distance':
      return <DistanceTracker {...props} />
    case 'attempts':
    case 'max':
      return <AttemptsTracker {...props} />
    case 'info':
      return null
  }
}

/* ───────────────────────── info card ───────────────────────── */

function InfoCard({ eff, locked }: { eff: EffectiveExercise; locked: boolean }) {
  const { ex, lib } = eff
  const meta = metaLine(eff)
  const note = clean(ex.note)
  return (
    <article className={`card ex-card ex-card--info${locked ? ' ex-card--locked' : ''}`}>
      <div className="ex-info">
        <span className="ex-pos num">{position(eff)}</span>
        <div className="ex-head__main">
          <h2 className="ex-head__name" tabIndex={-1}>
            {ex.name}
          </h2>
          {meta && <p className="ex-head__meta">{meta}</p>}
          {note && <p className="ex-note">{note}</p>}
        </div>
      </div>
      {lib?.video_query && (
        <div className="ex-foot" inert={locked}>
          <VideoButton exKey={ex.key} fallbackQuery={lib.label} compact />
        </div>
      )}
    </article>
  )
}

/* ───────────────────────── tracked card ───────────────────────── */

function TrackedCard({ date, plan, eff, session, locked, home = false }: ExerciseCardProps) {
  const titleId = useId()
  const [resetKey, setResetKey] = useState(0)
  const { ex, lib } = eff
  const log = session?.exercises[String(eff.index)]
  const isCheck = ex.key === CHECK_KEY
  const planned = eff.sets ?? 1
  const rows = Math.max(rowCount(log, planned), planned)
  const done = setsDone(log)
  const complete = !eff.hidden && planned > 0 && done >= planned
  const warmup = plan.warmups[ex.key]
  const note = clean(ex.note)
  const rest = ex.rest_s ? formatRestRange(ex.rest_s, ex.rest_max_s) : null
  const hasData = Boolean(log && (log.sets.length > 0 || log.text))
  const meta = metaLine(eff)
  const noun = isAttemptKind(ex) ? 'tentativi' : 'serie'

  const className = [
    'card',
    'ex-card',
    ex.test && 'ex-card--test',
    locked && 'ex-card--locked',
    eff.hidden && 'ex-card--hidden',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      className={className}
      data-state={complete ? 'done' : done > 0 ? 'started' : 'todo'}
      aria-labelledby={titleId}
    >
      <header className="ex-head">
        <span className="ex-pos num" aria-hidden="true">
          {complete ? '✓' : position(eff)}
        </span>
        <div className="ex-head__main">
          <h2 id={titleId} className="ex-head__name" tabIndex={-1}>
            {ex.name}
          </h2>
          {meta && <p className="ex-head__meta">{meta}</p>}
          <p className="ex-head__badges">
            {home && (
              <span className="badge ex-badge-lc">
                <IconHome className="ex-badge-icon" aria-hidden="true" /> A casa
              </span>
            )}
            {ex.test && <span className="badge badge--test">Test</span>}
            {ex.per_side && <span className="badge ex-badge-lc">dx/sx</span>}
            {eff.halved && <span className="badge badge--warn ex-badge-lc">½ serie</span>}
            {eff.hidden && <span className="badge badge--danger ex-badge-lc">saltato</span>}
            {complete ? (
              <span className="badge badge--ok ex-badge-lc">✓ fatto</span>
            ) : (
              done > 0 && (
                <span className="badge badge--accent num">
                  <span aria-hidden="true">
                    {done}/{planned}
                  </span>
                  <span className="visually-hidden">
                    {done} {noun} su {planned}
                  </span>
                </span>
              )
            )}
          </p>
        </div>
      </header>

      <div className="ex-body" inert={locked}>
        <div className="ex-tools">
          <VideoButton exKey={ex.key} fallbackQuery={lib?.label ?? ex.name} />
          {rest && (
            <p className="ex-rest">
              <IconTimer aria-hidden="true" /> Recupero <strong className="num">{rest}</strong>
            </p>
          )}
        </div>
        {eff.hidden && eff.hiddenReason && <p className="banner banner--warn small">{HIDDEN_TEXT[eff.hiddenReason]}</p>}
        {note && <p className="ex-note">{note}</p>}
        {isCheck ? (
          <ElbowStatus plan={plan} session={session} />
        ) : (
          !eff.hidden && (
            <>
              <Tracker key={resetKey} t={{ date, eff, rows }} log={log} />
              <RowControls date={date} eff={eff} log={log} rows={rows} planned={planned} />
              {ex.test && <TestNotes date={date} index={eff.index} text={log?.text} />}
            </>
          )
        )}
        {/* After the timer: start it, then follow the points while it runs. */}
        {warmup && <WarmupList warmup={warmup} />}
        {!isCheck && hasData && (
          <div className="ex-foot">
            <ResetButton
              onConfirm={() => {
                // Running holds/countdowns of the cleared rows would come back (or ring) later.
                clearExerciseTimers(date, eff.index)
                resetExercise(date, eff.index)
                setResetKey((k) => k + 1)
              }}
            />
          </div>
        )}
      </div>
    </article>
  )
}

/* ───────────────────────── parts ───────────────────────── */

/** check-gomito: the score is entered by the day screen; here only its outcome. */
function ElbowStatus({ plan, session }: { plan: Plan; session: SessionLog | undefined }) {
  const score = session?.elbowPre ?? null
  const override = session?.elbowOverride ?? null
  if (score == null) {
    // A colour chosen by hand settles the check without a score (the gate is gone).
    return override ? (
      <p className={`banner ${LEVEL_BANNER[override]} ex-elbow`}>
        Semaforo impostato a mano: {levelEmoji(override)} {levelLabel(override)} · senza voto (aggiungilo con
        «Modifica» in alto)
      </p>
    ) : (
      <p className="banner banner--info ex-elbow">Da fare in cima alla pagina</p>
    )
  }
  const level = elbowLevel(score, plan.elbow)
  return (
    <p className={`banner ${LEVEL_BANNER[override ?? level]} ex-elbow`}>
      Voto gomito: <strong className="num">{score}/10</strong> {levelEmoji(level)} {levelLabel(level)}
      {override && override !== level && (
        <span className="ex-elbow__override small">
          Semaforo impostato a mano: {levelEmoji(override)} {levelLabel(override)}
        </span>
      )}
    </p>
  )
}

interface RowControlsProps {
  date: string
  eff: EffectiveExercise
  log: ExerciseLog | undefined
  rows: number
  planned: number
}

/** "+ Serie / + Tentativo" up to sets_max, "−" to drop the last extra row while it is empty. */
function RowControls({ date, eff, log, rows, planned }: RowControlsProps) {
  const attempts = isAttemptKind(eff.ex)
  const maxRows = Math.max(eff.setsMax ?? eff.sets ?? 1, planned)
  const floor = Math.max(planned, log?.setsPlanned ?? 0)
  const canAdd = rows < maxRows
  const canRemove = rows > floor && isUntouched(log?.sets[rows - 1])
  if (!canAdd && !canRemove) return null
  return (
    <div className="ex-rowctl">
      {canAdd && (
        <button type="button" className="btn btn--outline" onClick={() => addSet(date, eff.index)}>
          <IconPlus /> {attempts ? 'Tentativo' : 'Serie'}
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="btn btn--outline btn--icon"
          aria-label={attempts ? "Rimuovi l'ultimo tentativo aggiunto" : "Rimuovi l'ultima serie aggiunta"}
          onClick={() => removeExtraSet(date, eff.index)}
        >
          <IconMinus />
        </button>
      )}
      {canAdd && <span className="muted small">fino a {maxRows}</span>}
    </div>
  )
}

const CONFIRM_TIMEOUT_MS = 5000

/** Two-step "Azzera": asks for confirmation inline, then clears every set of the exercise. */
function ResetButton({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!asking) return
    const id = setTimeout(() => setAsking(false), CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [asking])

  if (!asking) {
    return (
      <button type="button" className="btn btn--ghost ex-mini" onClick={() => setAsking(true)}>
        <IconReset /> Azzera
      </button>
    )
  }
  return (
    <div className="ex-reset" role="group" aria-label="Azzerare tutte le serie di questo esercizio?">
      <span className="small">Azzerare tutto?</span>
      <button
        type="button"
        className="btn btn--danger ex-mini"
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        Sì, azzera
      </button>
      <button type="button" className="btn btn--ghost ex-mini" autoFocus onClick={() => setAsking(false)}>
        No
      </button>
    </div>
  )
}
