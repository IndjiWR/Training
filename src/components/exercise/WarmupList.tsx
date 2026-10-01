import { useState } from 'react'
import type { Warmup } from '../../plan/schema'
import { IconChevronDown } from '../icons'

/** Collapsible warm-up routine (plan.warmups[key]), open by default. */
export function WarmupList({ warmup }: { warmup: Warmup }) {
  const [open, setOpen] = useState(true)
  return (
    <details className="ex-warmup" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ex-warmup__sum">
        <span className="ex-warmup__title">{warmup.title ?? 'Riscaldamento'}</span>
        <IconChevronDown className="ex-warmup__chev" />
      </summary>
      {warmup.items.length > 0 ? (
        <ol className="ex-warmup__list">
          {warmup.items.map((item, k) => (
            <li key={k} className="ex-warmup__item">
              <div className="ex-warmup__row">
                <span className="ex-warmup__name">{item.name}</span>
                {item.dose && <span className="ex-warmup__dose num">{item.dose}</span>}
              </div>
              {item.note && <p className="muted small">{item.note}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">Nessun esercizio indicato.</p>
      )}
    </details>
  )
}
