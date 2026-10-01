import type { Day } from '../../plan/schema'
import { formatLongDate } from '../../lib/date'
import { IconChevronRight } from '../icons'
import { capitalize, DAY_TYPE_LABEL, hasText } from './dayUtils'
import './day.css'

/**
 * Day header: long date, type badge, title, where / bring / duration and the day note.
 * `compact` (session running): date and title on top, the rest collapsed, so the exercises come
 * up sooner.
 */
export function DayHeader({ day, compact = false }: { day: Day; compact?: boolean }) {
  const info: Array<[string, string]> = []
  if (hasText(day.where)) info.push(['Dove', day.where])
  if (hasText(day.bring)) info.push(['Portare', day.bring])
  if (hasText(day.duration)) info.push(['Durata', day.duration])

  const badge = (
    <span className={day.type === 'RIPOSO' ? 'badge' : 'badge badge--accent'}>{DAY_TYPE_LABEL[day.type]}</span>
  )
  const details = (
    <>
      {info.length > 0 && (
        <dl className="dy-info">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hasText(day.note) && <p className="banner banner--info pre-line">{day.note}</p>}
    </>
  )

  if (compact) {
    return (
      <header className="dy-head dy-head--compact">
        <div className="dy-head__line">
          {badge}
          <h1>{capitalize(formatLongDate(day.date))}</h1>
        </div>
        {hasText(day.title) && <p className="dy-head__title">{day.title}</p>}
        {(info.length > 0 || hasText(day.note)) && (
          <details className="dy-details">
            <summary>
              <IconChevronRight aria-hidden="true" />
              Dettagli del giorno
            </summary>
            <div className="dy-details__body">{details}</div>
          </details>
        )}
      </header>
    )
  }

  return (
    <header className="dy-head">
      <div className="row">{badge}</div>
      <h1>{capitalize(formatLongDate(day.date))}</h1>
      {hasText(day.title) && <p className="dy-head__title">{day.title}</p>}
      {details}
    </header>
  )
}
