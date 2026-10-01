import type { ReactNode } from 'react'
import type { SetLog } from '../../state/types'
import { DoneLine } from './DoneLine'
import { doneAt, SIDE_NAME, SIDES, valueAt, type DoneView, type Side } from './tracker'

export interface SideRowProps {
  set: SetLog | undefined
  setIndex: number
  /** Row title ("Serie 2") for accessible names. */
  title: string
  /** Side chosen by the user (else the first open side is active). */
  pickedSide: Side | null
  onPickSide: (side: Side) => void
  onUndo: (side: Side) => void
  renderEntry: (setIndex: number, side: Side) => ReactNode
  describeDone: (value: number | null, setIndex: number, side: Side) => DoneView
  isBest?: (setIndex: number, side: Side) => boolean
}

/** per_side row: dx then sx. One side at a time shows its entry, done sides are compact. */
export function SideRow({
  set,
  setIndex,
  title,
  pickedSide,
  onPickSide,
  onUndo,
  renderEntry,
  describeDone,
  isBest,
}: SideRowProps) {
  const open = SIDES.filter((s) => !doneAt(set, s))
  const activeSide = pickedSide && open.includes(pickedSide) ? pickedSide : (open[0] ?? null)

  return (
    <div className="ex-sides">
      {SIDES.map((side) => {
        const name = `${title}, ${SIDE_NAME[side]}`
        if (doneAt(set, side)) {
          return (
            <DoneLine
              key={side}
              title={side}
              sideTag
              name={name}
              view={describeDone(valueAt(set, side), setIndex, side)}
              best={isBest?.(setIndex, side)}
              onUndo={() => onUndo(side)}
            />
          )
        }
        if (side === activeSide) {
          return (
            <div key={side} className="ex-side" aria-label={name} role="group">
              <p className="ex-side__title">
                <span className="ex-tag">{side}</span> {SIDE_NAME[side]}
              </p>
              {renderEntry(setIndex, side)}
            </div>
          )
        }
        return (
          <button key={side} type="button" className="ex-pending" onClick={() => onPickSide(side)}>
            <span className="ex-tag">{side}</span>
            <span className="ex-pending__hint">Passa a {SIDE_NAME[side]}</span>
          </button>
        )
      })}
    </div>
  )
}
