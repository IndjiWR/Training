import { useState } from 'react'
import { formatValue } from '../../lib/format'
import { IconCheck } from '../icons'
import {
  complete,
  doneAt,
  draftKey,
  range,
  SIDE_NAME,
  SIDES,
  undo,
  type Side,
  type TrackerProps,
} from './tracker'

interface ToggleProps {
  label: string
  ariaLabel?: string
  done: boolean
  current: boolean
  onClick: () => void
}

function DistanceToggle({ label, ariaLabel, done, current, onClick }: ToggleProps) {
  const variant = done ? 'ex-toggle--done' : current ? 'btn--primary' : 'btn--outline'
  return (
    <button
      type="button"
      className={`btn btn--big btn--block ex-toggle ${variant}`}
      aria-pressed={done}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {done && <IconCheck />}
      {label}
    </button>
  )
}

/** distance: one big toggle per set ("Serie 2 · 30 m"); tapping a done set asks to undo it. */
export function DistanceTracker({ t, log }: TrackerProps) {
  const { ex } = t.eff
  const target = ex.target_max ?? ex.target_min
  const amount = target != null ? formatValue(target, ex.unit) : null
  const [confirming, setConfirming] = useState<string | null>(null)
  const sets = log?.sets ?? []
  const rows = range(t.rows)
  const firstOpen = rows.find((i) => !sets[i]?.done) ?? -1

  const toggle = (i: number, side: Side | null) => {
    const key = draftKey(i, side)
    if (doneAt(sets[i], side)) {
      setConfirming((c) => (c === key ? null : key))
    } else {
      setConfirming(null)
      complete(t, i, side, target)
    }
  }

  const confirmUndo = (i: number, side: Side | null) => {
    const name = side ? `la serie ${i + 1} (${SIDE_NAME[side]})` : `la serie ${i + 1}`
    return (
      <div className="ex-undo" role="group" aria-label={`Annullare ${name}?`}>
        <span className="small">Annullare {name}?</span>
        <button
          type="button"
          className="btn btn--danger ex-mini"
          onClick={() => {
            undo(t, i, side)
            setConfirming(null)
          }}
        >
          Sì, annulla
        </button>
        <button type="button" className="btn btn--ghost ex-mini" onClick={() => setConfirming(null)}>
          No
        </button>
      </div>
    )
  }

  if (rows.length === 0) return null

  return (
    <ol className="ex-sets">
      {rows.map((i) => {
        const set = sets[i]
        const title = `Serie ${i + 1}`
        const current = i === firstOpen
        const state = set?.done ? 'done' : current ? 'active' : 'pending'
        const askingSide = ex.per_side ? SIDES.find((s) => confirming === draftKey(i, s)) : undefined
        return (
          <li key={i} className="ex-set ex-set--plain" data-state={state} aria-current={current ? 'step' : undefined}>
            {ex.per_side ? (
              <div className="ex-dist-sides" role="group" aria-label={title}>
                <p className="ex-set__title">
                  {title}
                  {amount && <span className="ex-set__of"> · {amount} per lato</span>}
                </p>
                <div className="ex-dist-sides__btns">
                  {SIDES.map((side) => (
                    <DistanceToggle
                      key={side}
                      label={side}
                      ariaLabel={`${title}, ${SIDE_NAME[side]}`}
                      done={doneAt(set, side)}
                      current={current}
                      onClick={() => toggle(i, side)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <DistanceToggle
                label={amount ? `${title} · ${amount}` : title}
                done={Boolean(set?.done)}
                current={current}
                onClick={() => toggle(i, null)}
              />
            )}
            {askingSide && confirmUndo(i, askingSide)}
            {!ex.per_side && confirming === draftKey(i, null) && confirmUndo(i, null)}
          </li>
        )
      })}
    </ol>
  )
}
