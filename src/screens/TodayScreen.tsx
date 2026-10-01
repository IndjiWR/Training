import { useMemo } from 'react'
import type { Plan } from '../plan/schema'
import { applyElbow, CHECK_KEY, dayHasElbowCheck, sessionElbowLevel } from '../lib/elbow'
import { useWakeLock } from '../lib/wakeLock'
import { useAppData } from '../state/store'
import { DayExercises } from '../components/day/DayExercises'
import { DayHeader } from '../components/day/DayHeader'
import { DayLogCard } from '../components/day/DayLogCard'
import { DayPicker } from '../components/day/DayPicker'
import { sessionProgress } from '../components/day/dayUtils'
import { ElbowSection } from '../components/day/ElbowSection'
import { EmptyPlan } from '../components/day/EmptyPlan'
import { PlanStrip } from '../components/day/PlanStrip'
import { SessionPanel, SessionStart, SessionStatus } from '../components/day/SessionPanel'
import { useSelectedDay } from '../components/day/useSelectedDay'
import { useWorkoutActive } from '../components/day/useWorkoutActive'
import '../components/day/day.css'

/** "Oggi": the day of the plan (today's or the chosen one) with the whole session flow. */
export function TodayScreen() {
  const plan = useAppData((s) => s.plan)
  return <div className="dy-screen">{plan ? <PlanDay plan={plan} /> : <EmptyPlan />}</div>
}

function PlanDay({ plan }: { plan: Plan }) {
  const { index, today, defaultIndex, reason, select } = useSelectedDay(plan)
  const day = plan.days[index] ?? plan.days[0]
  const date = day.date

  const sessions = useAppData((s) => s.sessions)
  const session = sessions[date]

  const level = sessionElbowLevel(session, plan.elbow)
  const effs = useMemo(() => applyElbow(day, plan.library, level), [day, plan.library, level])
  const progress = useMemo(() => sessionProgress(effs, session), [effs, session])

  const hasCheck = dayHasElbowCheck(day)
  const elbowPending = hasCheck && session?.elbowPre == null && session?.elbowOverride == null
  const checkIndex = elbowPending ? day.exercises.findIndex((e) => e.key === CHECK_KEY) : -1
  const isRest = day.type === 'RIPOSO'
  // Rest days get the session UI too when they have something to track (e.g. active recovery) or
  // a session was started, so it can be closed (RPE, notes) like any other.
  const showSession =
    !isRest || Boolean(session?.startedAt) || effs.some((e) => !e.hidden && e.ex.kind !== 'info')

  // Follows the workout, not the shown day: an open session of any day, the rest timer or a running
  // exercise timer (warm-up countdown before "Inizia sessione") keep the screen on.
  const workoutActive = useWorkoutActive()
  const wake = useWakeLock(workoutActive)

  return (
    <>
      <PlanStrip plan={plan} />
      <DayPicker days={plan.days} selected={index} today={today} sessions={sessions} onSelect={select} />

      {reason === 'past' && (
        <p className="banner banner--warn" role="status">
          La scheda è terminata: aggiorna la scheda da <a href="#/impostazioni">Impostazioni</a>.
        </p>
      )}
      {reason === 'upcoming' && index === defaultIndex && (
        <p className="banner banner--info" role="status">
          Oggi non c'è allenamento in scheda: ecco il prossimo giorno.
        </p>
      )}

      <DayHeader day={day} />

      {showSession && <SessionStatus session={session} progress={progress} wakeLocked={wake.locked} />}

      {hasCheck && (
        <ElbowSection
          key={`elbow-${date}`}
          date={date}
          plan={plan}
          day={day}
          session={session}
          level={level}
          effs={effs}
          pending={elbowPending}
        />
      )}

      {showSession && <SessionStart date={date} session={session} elbowPending={elbowPending} />}

      <DayExercises
        key={`exercises-${date}`}
        date={date}
        plan={plan}
        session={session}
        effs={effs}
        locked={elbowPending}
        excludeIndex={checkIndex >= 0 ? checkIndex : null}
      />

      {showSession && (
        <SessionPanel key={`session-${date}`} date={date} session={session} progress={progress} elbow={plan.elbow} />
      )}

      <DayLogCard key={`log-${date}`} date={date} elbow={plan.elbow} />
    </>
  )
}
