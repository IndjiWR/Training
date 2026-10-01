import { useTimer } from '../../state/timers'
import { IconCheck } from '../icons'
import { CountdownTimer } from '../timers/CountdownTimer'
import { HoldTimer } from '../timers/HoldTimer'
import { ManualEntry } from './entries'
import { complete, timerId, type Side, type TrackerTarget } from './tracker'

interface TimerEntryBase {
  t: TrackerTarget
  setIndex: number
  side: Side | null
  /** Accessible / visible timer label ("Serie 2", "Tentativo 1, destra"). */
  label: string
}

export interface HoldEntryProps extends TimerEntryBase {
  targetMin: number | null
  targetMax: number | null
  prepSeconds?: number
  /** Label of the manual seconds field. */
  manualLabel: string
}

/** HoldTimer for a row/side; "Inserisci a mano" is offered only while no timer is running. */
export function HoldEntry({ t, setIndex, side, label, targetMin, targetMax, prepSeconds, manualLabel }: HoldEntryProps) {
  const id = timerId(t, setIndex, side)
  const running = useTimer(id) != null
  return (
    <div className="ex-entry">
      <HoldTimer
        key={id}
        id={id}
        targetMin={targetMin}
        targetMax={targetMax}
        prepSeconds={prepSeconds}
        label={label}
        onStop={(seconds) => complete(t, setIndex, side, seconds, { tap: false })}
      />
      {!running && (
        <ManualEntry label={manualLabel} unit="s" onSave={(seconds) => complete(t, setIndex, side, seconds)} />
      )}
    </div>
  )
}

export interface CountdownEntryProps extends TimerEntryBase {
  seconds: number
}

/** CountdownTimer for a row/side + "Segna fatto senza timer" while the countdown is not started. */
export function CountdownEntry({ t, setIndex, side, label, seconds }: CountdownEntryProps) {
  const id = timerId(t, setIndex, side)
  const running = useTimer(id) != null
  return (
    <div className="ex-entry">
      <CountdownTimer
        key={`${id}@${seconds}`}
        id={id}
        seconds={seconds}
        label={label}
        onComplete={(elapsed) => complete(t, setIndex, side, elapsed, { tap: false })}
      />
      {!running && (
        <button
          type="button"
          className="btn btn--ghost btn--block ex-ghost"
          onClick={() => complete(t, setIndex, side, seconds)}
        >
          <IconCheck /> Segna fatto senza timer
        </button>
      )}
    </div>
  )
}
