import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Day, Plan } from '../../plan/schema'
import { CHECK_KEY, type EffectiveExercise } from '../../lib/elbow'
import type { ElbowLevel, SessionLog } from '../../state/types'
import { ElbowBanner } from './ElbowBanner'
import { ElbowCheck } from './ElbowCheck'
import { ElbowSheet } from './ElbowSheet'
import './day.css'

export interface ElbowSectionProps {
  date: string
  plan: Plan
  day: Day
  session: SessionLog | undefined
  level: ElbowLevel | null
  effs: readonly EffectiveExercise[]
  /** True while the pre-session check is still to do. */
  pending: boolean
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Elbow area of a day with check-gomito: the gate while pending, then the traffic-light banner.
 * Owns the "Check gomito" sheet so it stays open when the gate turns into the banner.
 * Render with a key per date.
 */
export function ElbowSection({ date, plan, day, session, level, effs, pending }: ElbowSectionProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const checkEx = useMemo(() => day.exercises.find((e) => e.key === CHECK_KEY) ?? null, [day])

  // The tall gate collapses into the banner: bring the result into view if it ended up above.
  const bannerRef = useRef<HTMLDivElement>(null)
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) {
      bannerRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
    wasPending.current = pending
  }, [pending])

  return (
    <>
      {pending ? (
        <ElbowCheck date={date} plan={plan} checkEx={checkEx} onManual={openSheet} />
      ) : (
        level && (
          <div ref={bannerRef} className="dy-anchor">
            <ElbowBanner plan={plan} session={session} level={level} effs={effs} onEdit={openSheet} />
          </div>
        )
      )}
      <ElbowSheet open={sheetOpen} onClose={closeSheet} date={date} plan={plan} session={session} />
    </>
  )
}
