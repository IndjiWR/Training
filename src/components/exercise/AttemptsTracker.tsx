import { useMemo } from 'react'
import { formatShortDate } from '../../lib/date'
import { formatValue, unitLabel } from '../../lib/format'
import { bestResult, latestResult } from '../../lib/results'
import { useAppData } from '../../state/store'
import type { ExerciseLog } from '../../state/types'
import { ConfirmButton, CountEditor, CountEntry, NumberEntry, ScoreEntry } from './entries'
import { SetList } from './SetList'
import { HoldEntry } from './TimerEntries'
import {
  complete,
  draftKey,
  editValue,
  formatSeconds,
  resultUnit,
  SIDE_NAME,
  useDrafts,
  valueAt,
  type DoneView,
  type Side,
  type TrackerProps,
} from './tracker'

/** Index of the first done set whose side value equals `best` (-1 if none). */
function sideBestIndex(log: ExerciseLog | undefined, side: Side, best: number | null): number {
  if (!log || best == null) return -1
  return log.sets.findIndex((s) => s[side]?.done && s[side]?.value === best)
}

/** Value of the nearest earlier attempt of the same side, to prefill the next one. */
function previousAttempt(log: ExerciseLog | undefined, setIndex: number, side: Side | null): number | null {
  if (!log) return null
  for (let k = Math.min(setIndex, log.sets.length) - 1; k >= 0; k--) {
    const v = valueAt(log.sets[k], side)
    if (v != null) return v
  }
  return null
}

/**
 * attempts / max: one entry per attempt by result unit (s: stopwatch, rep: counter,
 * cm and others: number, 0-10: score grid, none: just "Fatto"); best attempt highlighted.
 */
export function AttemptsTracker({ t, log }: TrackerProps) {
  const { ex, lib } = t.eff
  const unit = resultUnit(ex, lib)
  const perSide = ex.per_side
  const sessions = useAppData((s) => s.sessions)
  const { drafts, setDraft, clearDraft } = useDrafts()

  const best = useMemo(() => bestResult(log), [log])
  const bestIdx = useMemo(
    () => ({ dx: sideBestIndex(log, 'dx', best.dx), sx: sideBestIndex(log, 'sx', best.sx) }),
    [log, best],
  )
  const previous = useMemo(
    () => (unit == null ? null : latestResult(sessions, ex.key, { date: t.date, index: t.eff.index })),
    [unit, sessions, ex.key, t.date, t.eff.index],
  )

  const fmt = (v: number) => (unit === 's' ? formatSeconds(v) : formatValue(v, unit))
  const single = ex.kind === 'max' && t.rows === 1
  const rowTitle = (i: number) => (single ? 'Massimale' : `Tentativo ${i + 1}`)
  const rowName = (i: number, side: Side | null) => (side ? `${rowTitle(i)}, ${SIDE_NAME[side]}` : rowTitle(i))

  const isBest =
    t.rows > 1
      ? (i: number, side: Side | null) => (side ? bestIdx[side] === i : !perSide && best.bestSetIndex === i)
      : undefined

  const summary = perSide
    ? [best.dx != null && `dx ${fmt(best.dx)}`, best.sx != null && `sx ${fmt(best.sx)}`].filter(Boolean).join(' · ')
    : best.best != null
      ? fmt(best.best)
      : ''

  const renderEntry = (i: number, side: Side | null) => {
    const name = rowName(i, side)
    const save = (value: number | null) => complete(t, i, side, value)
    const stored = valueAt(log?.sets[i], side)

    if (unit == null) return <ConfirmButton ariaLabel={`Fatto: ${name}`} onClick={() => save(null)} />

    if (unit === 's') {
      return (
        <HoldEntry
          t={t}
          setIndex={i}
          side={side}
          label={name}
          targetMin={null}
          targetMax={null}
          prepSeconds={3}
          manualLabel={`Secondi (${name.toLowerCase()})`}
        />
      )
    }

    if (unit === 'rep') {
      const key = draftKey(i, side)
      const value = drafts[key] ?? stored ?? previousAttempt(log, i, side) ?? previous?.value ?? 0
      // Max tests can be 20+ reps: ±5 buttons next to the ±1 stepper.
      return (
        <CountEntry
          label={`Ripetizioni ${name.toLowerCase()}`}
          value={value}
          unit="rip"
          quickStep={5}
          onChange={(v) => setDraft(key, v)}
          confirmLabel="Salva"
          confirmAriaLabel={`Salva ${name.toLowerCase()}: ${value} rip`}
          onConfirm={(v) => {
            save(v)
            clearDraft(key)
          }}
        />
      )
    }

    if (unit === '0-10') return <ScoreEntry label={`Voto ${name.toLowerCase()}`} initial={stored} onSave={save} />

    return (
      <NumberEntry
        label={`Misura (${name.toLowerCase()})`}
        unit={unitLabel(unit)}
        inputMode={unit === 'cm' ? 'numeric' : 'decimal'}
        initial={stored}
        big
        onSave={save}
      />
    )
  }

  const describeDone = (value: number | null, i: number, side: Side | null): DoneView => {
    if (value == null || unit == null) return { text: '' }
    const name = rowName(i, side).toLowerCase()
    const commit = (close: () => void) => (v: number) => {
      editValue(t, i, side, v)
      close()
    }
    let editor: DoneView['editor']
    if (unit === 'rep') {
      editor = (close) => (
        <CountEditor label={`Ripetizioni ${name}`} initial={value} unit="rip" quickStep={5} onSave={commit(close)} />
      )
    } else if (unit === '0-10') {
      editor = (close) => <ScoreEntry label={`Voto ${name}`} initial={value} big={false} onSave={commit(close)} />
    } else {
      editor = (close) => (
        <NumberEntry
          label={unit === 's' ? 'Secondi' : 'Misura'}
          unit={unitLabel(unit)}
          inputMode={unit === 's' || unit === 'cm' ? 'numeric' : 'decimal'}
          initial={value}
          onSave={commit(close)}
        />
      )
    }
    return { text: fmt(value), editor }
  }

  return (
    <div className="ex-tracker">
      {previous && (
        <p className="ex-target muted small">
          Precedente: <strong className="num">{fmt(previous.value)}</strong> · {formatShortDate(previous.date)}
        </p>
      )}
      <SetList
        t={t}
        log={log}
        rowTitle={rowTitle}
        renderEntry={renderEntry}
        describeDone={describeDone}
        isBest={isBest}
      />
      {summary && (
        <p className="ex-bestline" aria-live="polite">
          <span aria-hidden="true">★</span> {single ? 'Risultato' : 'Migliore'}: <strong className="num">{summary}</strong>
        </p>
      )}
    </div>
  )
}
