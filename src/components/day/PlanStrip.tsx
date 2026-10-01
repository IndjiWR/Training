import type { Plan } from '../../plan/schema'
import { IconChevronRight } from '../icons'
import { hasText } from './dayUtils'
import './day.css'

/** Compact plan header: title + period, goals and next check-in collapsible. */
export function PlanStrip({ plan }: { plan: Plan }) {
  const goals = hasText(plan.goals)
    ? plan.goals
        .split(/\s+·\s+|\n+/)
        .map((g) => g.trim())
        .filter(Boolean)
    : []
  const checkin = hasText(plan.next_checkin) ? plan.next_checkin : null

  return (
    <section className="dy-plan" aria-label="Scheda corrente">
      <p className="dy-plan__title">
        {plan.title ?? 'Scheda della settimana'}
        {hasText(plan.period) && <span className="muted"> · {plan.period}</span>}
      </p>
      {(goals.length > 0 || checkin) && (
        <details className="dy-details">
          <summary>
            <IconChevronRight />
            {goals.length > 0 ? 'Obiettivi' : 'Check-in'}
          </summary>
          <div className="dy-details__body small">
            {goals.length > 0 && (
              <ul className="dy-goals">
                {goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}
            {checkin && <p className="muted">Prossimo check-in: {checkin}</p>}
          </div>
        </details>
      )}
    </section>
  )
}
