import { useEffect, useRef } from 'react'
import type { Day } from '../../plan/schema'
import { formatShortDate } from '../../lib/date'
import type { SessionLog } from '../../state/types'
import { DAY_TYPE_LABEL } from './dayUtils'
import './day.css'

export interface DayPickerProps {
  days: readonly Day[]
  selected: number
  today: string
  sessions: Record<string, SessionLog>
  onSelect: (index: number) => void
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Horizontally scrollable day chips: date, type, "oggi" and ✓ for closed sessions. */
export function DayPicker({ days, selected, today, sessions, onSelect }: DayPickerProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const firstRun = useRef(true)

  // Keep the selected chip centred (horizontal scroll only: never moves the page).
  useEffect(() => {
    const list = listRef.current
    const chip = list?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!list || !chip) return
    const left = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2
    const smooth = !firstRun.current && !prefersReducedMotion()
    firstRun.current = false
    list.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' })
  }, [selected, days.length])

  return (
    <nav aria-label="Giorni della scheda">
      <div className="dy-picker" ref={listRef}>
        {days.map((d, i) => {
          const s = sessions[d.date]
          const closed = Boolean(s?.finishedAt)
          // A skip mark left on a session that was started afterwards does not count.
          const skipped = !closed && Boolean(s?.skipped) && !s?.startedAt
          const isToday = d.date === today
          const short = formatShortDate(d.date)
          const type = DAY_TYPE_LABEL[d.type]
          const status = closed ? 'sessione chiusa' : skipped ? 'saltata' : null
          const label = [short, type, isToday ? 'oggi' : null, status].filter(Boolean).join(', ')
          return (
            <button
              key={`${d.date}-${i}`}
              type="button"
              className="chip dy-daychip"
              aria-pressed={i === selected}
              aria-label={label}
              data-today={isToday || undefined}
              onClick={() => onSelect(i)}
            >
              {isToday && <span className="dy-daychip__today">oggi</span>}
              <span className="dy-daychip__date">
                {short}
                {closed && <span className="dy-daychip__mark"> ✓</span>}
                {skipped && <span className="dy-daychip__type"> –</span>}
              </span>
              <span className="dy-daychip__type">{type}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
