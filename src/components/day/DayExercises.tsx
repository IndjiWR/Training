import type { Plan } from '../../plan/schema'
import type { EffectiveExercise } from '../../lib/elbow'
import type { SessionLog } from '../../state/types'
import { ExerciseCard } from '../exercise/ExerciseCard'
import { HiddenList } from './HiddenList'
import './day.css'

export interface DayExercisesProps {
  date: string
  plan: Plan
  session: SessionLog | undefined
  /** The day after the elbow transform. */
  effs: readonly EffectiveExercise[]
}

/**
 * Days with nothing to track (e.g. rest: "Riposo", "check-in"): the items in a plain vertical
 * list. Days with exercises use the carousel (ExerciseCarousel).
 */
export function DayExercises({ date, plan, session, effs }: DayExercisesProps) {
  const visible = effs.filter((e) => !e.hidden)
  const hidden = effs.filter((e) => e.hidden)
  return (
    <>
      {visible.length > 0 && (
        <section className="dy-list" aria-label="Programma del giorno">
          {visible.map((e) => (
            <ExerciseCard key={e.index} date={date} plan={plan} eff={e} session={session} locked={false} home={e.ex.home} />
          ))}
        </section>
      )}
      {hidden.length > 0 && <HiddenList hidden={hidden} />}
    </>
  )
}
