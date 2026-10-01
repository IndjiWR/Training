import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Plan } from '../../plan/schema'
import type { EffectiveExercise } from '../../lib/elbow'
import type { SessionLog } from '../../state/types'
import { ExerciseCard } from '../exercise/ExerciseCard'
import { IconChevronRight, IconHome } from '../icons'
import { hiddenReasonText, isComplete } from './dayUtils'
import './day.css'

export interface DayExercisesProps {
  date: string
  plan: Plan
  session: SessionLog | undefined
  /** The day after the elbow transform. */
  effs: readonly EffectiveExercise[]
  /** Elbow check pending: cards visible but inert. */
  locked: boolean
  /** Exercise index left out of the list (the check-gomito while its gate is shown). */
  excludeIndex: number | null
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

const cardId = (index: number) => `dy-ex-${index}`

/**
 * Single expanded card, controlled here. Starts on the first incomplete exercise; when the
 * expanded exercise becomes complete, the next incomplete one (forward only) opens and scrolls
 * into view. Manual toggles are always respected. Mount with key={date}.
 */
function useExpanded(order: readonly number[], complete: ReadonlyMap<number, boolean>) {
  const firstIncomplete = order.find((i) => !complete.get(i)) ?? null
  const [chosen, setChosen] = useState<number | null>(firstIncomplete)
  // A card hidden by an elbow change falls back to the first incomplete visible one.
  const expanded = chosen != null && !order.includes(chosen) ? firstIncomplete : chosen

  const prev = useRef<{ index: number | null; complete: boolean } | null>(null)
  const scrollTarget = useRef<number | null>(null)

  useEffect(() => {
    const done = expanded != null && complete.get(expanded) === true
    const p = prev.current
    prev.current = { index: expanded, complete: done }
    if (expanded == null || !done || !p || p.index !== expanded || p.complete) return
    const next = order.slice(order.indexOf(expanded) + 1).find((i) => !complete.get(i))
    if (next == null) return
    scrollTarget.current = next
    setChosen(next)
  }, [expanded, complete, order])

  useEffect(() => {
    if (expanded == null || scrollTarget.current !== expanded) return
    scrollTarget.current = null
    document
      .getElementById(cardId(expanded))
      ?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [expanded])

  const toggle = useCallback((index: number) => setChosen(expanded === index ? null : index), [expanded])
  return { expanded, toggle }
}

/** Exercises of the day: main list in order, "A casa" group, hidden-by-elbow list. */
export function DayExercises({ date, plan, session, effs, locked, excludeIndex }: DayExercisesProps) {
  const { main, home, hidden, order } = useMemo(() => {
    const visible = effs.filter((e) => !e.hidden && e.index !== excludeIndex)
    const main = visible.filter((e) => !e.ex.home)
    const home = visible.filter((e) => e.ex.home)
    return {
      main,
      home,
      hidden: effs.filter((e) => e.hidden),
      order: [...main, ...home].map((e) => e.index),
    }
  }, [effs, excludeIndex])

  const complete = useMemo(() => new Map(effs.map((e) => [e.index, isComplete(e, session)])), [effs, session])
  const { expanded, toggle } = useExpanded(order, complete)

  const renderCard = (e: EffectiveExercise) => (
    <div key={e.index} id={cardId(e.index)} className="dy-ex">
      <ExerciseCard
        date={date}
        plan={plan}
        eff={e}
        session={session}
        locked={locked}
        expanded={expanded === e.index}
        onToggle={() => toggle(e.index)}
      />
    </div>
  )

  return (
    <>
      {main.length > 0 && (
        <section className="dy-list" aria-label="Esercizi">
          <h2 className="dy-section">Esercizi · {main.length}</h2>
          {main.map(renderCard)}
        </section>
      )}

      {home.length > 0 && (
        <section className="dy-list" aria-label="A casa">
          <h2 className="dy-section">
            <IconHome />A casa · {home.length}
          </h2>
          {home.map(renderCard)}
        </section>
      )}

      {hidden.length > 0 && (
        <details className="card dy-details dy-hidden">
          <summary>
            <IconChevronRight />
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
      )}
    </>
  )
}
