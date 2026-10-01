import { CountEditor, CountEntry } from './entries'
import { PercentMaxInfo, usePercentMax } from './PercentMaxInfo'
import { SetList } from './SetList'
import {
  complete,
  draftKey,
  editValue,
  formatBand,
  repsUnit,
  SIDE_NAME,
  useDrafts,
  valueAt,
  type Side,
  type TrackerProps,
} from './tracker'

/** reps: per set a +/− counter prefilled with the target (or the %max reps), then "✓ Fatto". */
export function RepsTracker({ t, log }: TrackerProps) {
  const { ex } = t.eff
  const isPct = ex.unit === '%max'
  const pm = usePercentMax(ex, t.date, t.eff.index)
  const unit = repsUnit(ex)
  const target = isPct ? (pm?.max ?? 0) : (ex.target_max ?? ex.target_min ?? 0)
  const band = isPct ? null : formatBand(ex.target_min, ex.target_max, ex.unit ?? 'rep')
  const { drafts, setDraft, clearDraft } = useDrafts()

  const rowName = (i: number, side: Side | null) => (side ? `serie ${i + 1}, ${SIDE_NAME[side]}` : `serie ${i + 1}`)

  return (
    <div className="ex-tracker">
      {isPct ? (
        <PercentMaxInfo ex={ex} pm={pm} unit={unit} />
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
        pendingHint={isPct && !pm ? null : `${target} ${unit}`}
        renderEntry={(i, side) => {
          const key = draftKey(i, side)
          const value = drafts[key] ?? valueAt(log?.sets[i], side) ?? target
          return (
            <CountEntry
              label={`Ripetizioni ${rowName(i, side)}`}
              value={value}
              unit={unit}
              onChange={(v) => setDraft(key, v)}
              confirmLabel={side ? `Fatto ${side}` : 'Fatto'}
              confirmAriaLabel={`Fatto: ${rowName(i, side)}, ${value} ${unit}`}
              onConfirm={(v) => {
                complete(t, i, side, v)
                clearDraft(key)
              }}
            />
          )
        }}
        describeDone={(value, i, side) => ({
          text: value != null ? `${value} ${unit}` : 'fatto',
          editor: (close) => (
            <CountEditor
              label={`Ripetizioni ${rowName(i, side)}`}
              initial={value ?? target}
              unit={unit}
              onSave={(v) => {
                editValue(t, i, side, v)
                close()
              }}
            />
          ),
        })}
      />
    </div>
  )
}
