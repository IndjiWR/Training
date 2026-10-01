import { NumberEntry } from './entries'
import { PercentMaxInfo, usePercentMax } from './PercentMaxInfo'
import { SetList } from './SetList'
import { HoldEntry } from './TimerEntries'
import {
  editValue,
  formatBand,
  formatSeconds,
  SIDE_NAME,
  targetSeconds,
  type Side,
  type TrackerProps,
} from './tracker'

/** In range / under / over the target band (text, not only color). */
export function BandFeedback({ value, min, max }: { value: number; min: number | null; max: number | null }) {
  if (min == null && max == null) return null
  if (min != null && value < min) return <span className="ex-fb ex-fb--under">sotto il range</span>
  if (max != null && value > max) return <span className="ex-fb ex-fb--over">oltre il range</span>
  return <span className="ex-fb ex-fb--ok">✓ nel range</span>
}

/** hold: per set a HoldTimer (3-2-1, count-up with the target band), tap to stop and save. */
export function HoldTracker({ t, log }: TrackerProps) {
  const { ex } = t.eff
  const isPct = ex.unit === '%max'
  const pm = usePercentMax(ex, t.date, t.eff.index)
  const minS = isPct ? (pm?.min ?? null) : targetSeconds(ex.target_min, ex.unit)
  const maxS = isPct ? (pm?.max ?? null) : targetSeconds(ex.target_max, ex.unit)
  // per_side %max with a max recorded per side: each side's band comes from its own max.
  const sides = pm?.sides ?? null
  const limitsFor = (side: Side | null): { min: number | null; max: number | null } =>
    side && sides ? sides[side] : { min: minS, max: maxS }
  const band = isPct ? null : formatBand(ex.target_min, ex.target_max, ex.unit ?? 's')

  const rowName = (i: number, side: Side | null) => (side ? `Serie ${i + 1}, ${SIDE_NAME[side]}` : `Serie ${i + 1}`)

  return (
    <div className="ex-tracker">
      {isPct ? (
        <PercentMaxInfo ex={ex} pm={pm} unit="s" />
      ) : (
        band && (
          <p className="ex-target">
            Obiettivo <strong className="num">{band}</strong>
            {ex.per_side && ' per lato'}
          </p>
        )
      )}
      <SetList
        t={t}
        log={log}
        rowTitle={(i) => `Serie ${i + 1}`}
        pendingHint={band}
        renderEntry={(i, side) => (
          <HoldEntry
            t={t}
            setIndex={i}
            side={side}
            label={rowName(i, side)}
            targetMin={limitsFor(side).min}
            targetMax={limitsFor(side).max}
            manualLabel={`Secondi tenuti (${rowName(i, side).toLowerCase()})`}
          />
        )}
        describeDone={(value, i, side) => ({
          text: value != null ? formatSeconds(value) : 'fatto',
          feedback:
            value != null ? <BandFeedback value={value} min={limitsFor(side).min} max={limitsFor(side).max} /> : null,
          editor: (close) => (
            <NumberEntry
              label="Secondi tenuti"
              unit="s"
              inputMode="numeric"
              initial={value}
              onSave={(s) => {
                editValue(t, i, side, s)
                close()
              }}
            />
          ),
        })}
      />
    </div>
  )
}
