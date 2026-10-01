import type { Elbow } from '../../plan/schema'
import { levelEmoji, levelLabel, rulesText } from '../../lib/elbow'
import type { ElbowLevel } from '../../state/types'
import { IconWarning } from '../icons'
import { levelRanges, levelTone } from './dayUtils'
import './day.css'

/** Small building blocks shared by the elbow gate, banner and sheet. */

/** "🟡 GIALLO" */
export function levelText(level: ElbowLevel): string {
  return `${levelEmoji(level)} ${levelLabel(level).toUpperCase()}`
}

/** The STOP rule (elbow.rules.stop): always visible wherever the elbow is scored. */
export function StopRule({ text }: { text: string }) {
  return (
    <div className="banner banner--danger dy-stop" role="note">
      <IconWarning />
      <p className="small">
        <strong>Stop: </strong>
        {text}
      </p>
    </div>
  )
}

/** Live preview of the level for a score + its rule text. */
export function LevelPreview({ score, level, elbow }: { score: number | null; level: ElbowLevel; elbow: Elbow | null }) {
  const rules = rulesText(elbow, level)
  return (
    <div className={`banner banner--${levelTone(level)} stack-sm`} aria-live="polite">
      <p className="dy-level">
        {score != null && <span className="num">{score}/10 · </span>}
        {levelText(level)}
      </p>
      {rules && <p className="small">{rules}</p>}
    </div>
  )
}

/** "🟢 0–3 · 🟡 4–5 · 🔴 6–10" from the plan thresholds. */
export function LevelLegend({ elbow }: { elbow: Elbow | null }) {
  return (
    <ul className="dy-legend" aria-label="Soglie del semaforo">
      {levelRanges(elbow).map((r) => (
        <li key={r.level}>
          {levelEmoji(r.level)} {levelLabel(r.level)} {r.from === r.to ? r.from : `${r.from}–${r.to}`}
        </li>
      ))}
    </ul>
  )
}
