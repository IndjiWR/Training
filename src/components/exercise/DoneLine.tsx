import { useId, useState } from 'react'
import { IconCheck } from '../icons'
import type { DoneView } from './tracker'

export interface DoneLineProps {
  /** Visible short title ("Serie 2", "dx"); may be empty. */
  title: string
  /** Accessible name of the row ("Serie 2, destra"). */
  name: string
  view: DoneView
  /** Highlight as best attempt. */
  best?: boolean
  /** Render the title as a side tag (dx/sx). */
  sideTag?: boolean
  onUndo: () => void
}

/**
 * Compact done row: ✓ title value [feedback] … [Annulla].
 * Tapping the value opens the inline editor when the view provides one.
 */
export function DoneLine({ title, name, view, best = false, sideTag = false, onUndo }: DoneLineProps) {
  const [editing, setEditing] = useState(false)
  const editorId = useId()

  const content = (
    <>
      <IconCheck className="ex-done__check" />
      <span className="ex-done__body">
        {title && <span className={sideTag ? 'ex-tag' : 'ex-done__title'}>{title}</span>}
        {view.text && <span className="ex-done__value">{view.text}</span>}
        {best && <span className="badge badge--ok ex-best">★ Migliore</span>}
        {view.feedback}
      </span>
    </>
  )

  return (
    <div className="ex-done" data-best={best ? 'true' : undefined}>
      <div className="ex-done__line">
        {view.editor ? (
          <button
            type="button"
            className="ex-done__main"
            aria-expanded={editing}
            aria-controls={editorId}
            onClick={() => setEditing((e) => !e)}
          >
            <span className="visually-hidden">Modifica {name}: </span>
            {content}
            <span className="ex-done__edit" aria-hidden="true">
              ✎
            </span>
          </button>
        ) : (
          <div className="ex-done__main">{content}</div>
        )}
        <button type="button" className="btn btn--ghost ex-mini" aria-label={`Annulla ${name}`} onClick={onUndo}>
          Annulla
        </button>
      </div>
      {view.editor && (
        <div id={editorId} className="ex-edit" hidden={!editing}>
          {editing && view.editor(() => setEditing(false))}
        </div>
      )}
    </div>
  )
}
