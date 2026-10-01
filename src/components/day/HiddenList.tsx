import type { EffectiveExercise } from '../../lib/elbow'
import { IconChevronRight } from '../icons'
import { hiddenReasonText } from './dayUtils'
import './day.css'

/** Exercises hidden by the elbow rules today, collapsed. */
export function HiddenList({ hidden }: { hidden: readonly EffectiveExercise[] }) {
  return (
    <details className="card dy-details dy-hidden">
      <summary>
        <IconChevronRight aria-hidden="true" />
        Nascosti per il gomito ({hidden.length})
      </summary>
      <div className="dy-details__body">
        <ul className="small">
          {hidden.map((e) => (
            <li key={e.index}>
              {e.ex.name} <span className="muted">— {hiddenReasonText(e.hiddenReason)}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
