import { useState, type ReactNode } from 'react'
import { DoneLine } from './DoneLine'
import { SideRow } from './SideRow'
import { doneAt, range, SIDES, undo, type DoneView, type Side, type TrackerProps } from './tracker'

export interface SetListProps extends TrackerProps {
  /** Row title: "Serie 2", "Tentativo 1", "Massimale" or "" (single timed block). */
  rowTitle: (setIndex: number) => string
  /** Target shown on collapsed pending rows (e.g. "12 rip"). */
  pendingHint?: string | null
  /** Entry controls of an open set (side = null) or side. */
  renderEntry: (setIndex: number, side: Side | null) => ReactNode
  describeDone: (value: number | null, setIndex: number, side: Side | null) => DoneView
  isBest?: (setIndex: number, side: Side | null) => boolean
}

/**
 * Rows of an exercise. Done rows are compact (✓ value, edit, Annulla); the current row
 * (first not done, or the one the user tapped) is expanded with its entry controls;
 * the other open rows are collapsed buttons that make them current.
 */
export function SetList({ t, log, rowTitle, pendingHint, renderEntry, describeDone, isBest }: SetListProps) {
  const [picked, setPicked] = useState<{ row: number; side: Side | null } | null>(null)
  const perSide = t.eff.ex.per_side
  const sets = log?.sets ?? []
  const rows = range(t.rows)
  const isDone = (i: number) => Boolean(sets[i]?.done)
  const firstOpen = rows.find((i) => !isDone(i)) ?? -1
  const active = picked && picked.row < t.rows && !isDone(picked.row) ? picked.row : firstOpen

  /** Undo re-opens that row/side for editing (the value is kept as prefill). */
  const undoAt = (i: number, side: Side | null) => {
    undo(t, i, side)
    setPicked({ row: i, side })
  }

  if (rows.length === 0) return null

  return (
    <ol className="ex-sets">
      {rows.map((i) => {
        const set = sets[i]
        const title = rowTitle(i)
        const name = title || t.eff.ex.name

        if (perSide && (set?.done || i === active)) {
          const state = set?.done ? 'done' : 'active'
          return (
            <li key={i} className="ex-set" data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
              {title && (
                <p className="ex-set__title">
                  {title}
                  {state === 'active' && t.rows > 1 && <span className="ex-set__of"> di {t.rows}</span>}
                </p>
              )}
              <SideRow
                set={set}
                setIndex={i}
                title={name}
                pickedSide={picked?.row === i ? picked.side : null}
                onPickSide={(side) => setPicked({ row: i, side })}
                onUndo={(side) => undoAt(i, side)}
                renderEntry={renderEntry}
                describeDone={describeDone}
                isBest={isBest}
              />
            </li>
          )
        }

        if (set?.done) {
          return (
            <li key={i} className="ex-set" data-state="done">
              <DoneLine
                title={title}
                name={name}
                view={describeDone(set.value, i, null)}
                best={isBest?.(i, null)}
                onUndo={() => undoAt(i, null)}
              />
            </li>
          )
        }

        if (i !== active) {
          const partial = perSide ? SIDES.filter((s) => doneAt(set, s)) : []
          const hint = partial.length ? `${partial.join(' e ')} ✓` : pendingHint
          return (
            <li key={i} className="ex-set" data-state="pending">
              <button type="button" className="ex-pending" onClick={() => setPicked({ row: i, side: null })}>
                <span className="ex-pending__title">{title || 'Da fare'}</span>
                {hint && <span className="ex-pending__hint">{hint}</span>}
              </button>
            </li>
          )
        }

        return (
          <li key={i} className="ex-set" data-state="active" aria-current="step">
            {title && (
              <p className="ex-set__title">
                {title}
                {t.rows > 1 && <span className="ex-set__of"> di {t.rows}</span>}
              </p>
            )}
            {renderEntry(i, null)}
          </li>
        )
      })}
    </ol>
  )
}
