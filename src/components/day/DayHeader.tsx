import type { Day } from '../../plan/schema'
import { formatLongDate } from '../../lib/date'
import { capitalize, DAY_TYPE_LABEL, hasText } from './dayUtils'
import './day.css'

/** Day header: long date, type badge, title, where / bring / duration and the day note. */
export function DayHeader({ day }: { day: Day }) {
  const info: Array<[string, string]> = []
  if (hasText(day.where)) info.push(['Dove', day.where])
  if (hasText(day.bring)) info.push(['Portare', day.bring])
  if (hasText(day.duration)) info.push(['Durata', day.duration])

  return (
    <header className="dy-head">
      <div className="row">
        <span className={day.type === 'RIPOSO' ? 'badge' : 'badge badge--accent'}>{DAY_TYPE_LABEL[day.type]}</span>
      </div>
      <h1>{capitalize(formatLongDate(day.date))}</h1>
      {hasText(day.title) && <p className="dy-head__title">{day.title}</p>}
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
    </header>
  )
}
