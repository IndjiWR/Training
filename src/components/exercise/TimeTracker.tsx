import { useState } from 'react'
import { formatClock, toSeconds } from '../../lib/format'
import { useAllTimers } from '../../state/timers'
import { ConfirmButton, NumberEntry } from './entries'
import { SetList } from './SetList'
import { CountdownEntry } from './TimerEntries'
import {
  complete,
  durationLabel,
  editValue,
  exerciseTimerPrefix,
  optionForDuration,
  range,
  SIDE_NAME,
  type Side,
  type TrackerProps,
} from './tracker'

/** time: countdown per block (usually one). Two chips when the plan gives a range ("20-30'"). */
export function TimeTracker({ t, log }: TrackerProps) {
  const { ex, lib } = t.eff
  const options = [...new Set([ex.target_min, ex.target_max].filter((n): n is number => n != null))].sort(
    (a, b) => a - b,
  )
  const fallback = ex.target_max ?? ex.target_min
  const [choice, setChoice] = useState<number | null>(fallback)
  // Keep the duration fixed while one of this exercise's countdowns exists. The running one wins
  // over the local choice, which a remount (collapsed card, other tab) resets to the fallback.
  const timers = useAllTimers()
  const prefix = exerciseTimerPrefix(t.date, t.eff.index)
  const own = Object.entries(timers)
    .filter(([id]) => id.startsWith(prefix))
    .map(([, timer]) => timer)
  const busy = own.length > 0
  const runningMs = own.find((timer) => timer.mode === 'countdown')?.durationMs ?? null
  const runningChoice = optionForDuration(options, ex.unit, runningMs)
  // Adopt it as the local choice too, so it is kept after the countdown is reset ("Azzera").
  if (runningChoice !== undefined && runningChoice !== choice) setChoice(runningChoice)
  const chosen = runningChoice ?? (choice != null && options.includes(choice) ? choice : fallback)
  const seconds = toSeconds(chosen, ex.unit)
  const single = t.rows === 1
  const timerLabel = lib?.label ?? ex.name
  const allDone = range(t.rows).every((i) => log?.sets[i]?.done)

  const rowName = (i: number, side: Side | null) => {
    const base = single ? timerLabel : `Serie ${i + 1}`
    return side ? `${base}, ${SIDE_NAME[side]}` : base
  }

  return (
    <div className="ex-tracker">
      {options.length > 1 && !allDone && (
        <div className="ex-chips" role="group" aria-label="Durata">
          <span className="muted small">Durata</span>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className="chip"
              aria-pressed={o === chosen}
              disabled={busy && o !== chosen}
              onClick={() => setChoice(o)}
            >
              {durationLabel(o, ex.unit)}
            </button>
          ))}
        </div>
      )}
      <SetList
        t={t}
        log={log}
        rowTitle={(i) => (single ? '' : `Serie ${i + 1}`)}
        pendingHint={chosen != null ? durationLabel(chosen, ex.unit) : null}
        renderEntry={(i, side) =>
          seconds == null ? (
            <ConfirmButton ariaLabel={`Fatto: ${rowName(i, side)}`} onClick={() => complete(t, i, side, null)} />
          ) : (
            <CountdownEntry t={t} setIndex={i} side={side} label={rowName(i, side)} seconds={seconds} />
          )
        }
        describeDone={(value, i, side) => ({
          text: value != null ? `Fatto · ${formatClock(value)}` : 'Fatto',
          editor: (close) => (
            <NumberEntry
              label="Minuti fatti"
              unit="min"
              initial={value != null ? Math.round(value / 6) / 10 : null}
              onSave={(minutes) => {
                editValue(t, i, side, Math.round(minutes * 60))
                close()
              }}
            />
          ),
        })}
      />
    </div>
  )
}
