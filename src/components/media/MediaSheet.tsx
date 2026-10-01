import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseMediaUrl, youtubeSearchUrl } from '../../lib/media'
import { setPin } from '../../state/actions'
import { toast } from '../../state/ui'
import { IconExternal, IconPin, IconTrash, IconVideo } from '../icons'
import { Sheet } from '../ui'
import { usePin } from './hooks'
import { MediaView } from './MediaView'
import { PinEditor } from './PinEditor'
import './media.css'

export type MediaSheetMode = 'view' | 'edit'

export interface MediaSheetProps {
  exKey: string
  /** Exercise label (sheet title). */
  label: string
  /** YouTube search query. */
  query: string
  /** 'view' shows the pinned media, 'edit' the pin editor. */
  initialMode: MediaSheetMode
  /** Must be referentially stable (the Sheet re-runs its focus effect when it changes). */
  onClose: () => void
}

/**
 * Bottom sheet with the pinned media of a library key and its actions, or the pin editor.
 * Mount it only while open (state resets on every opening). Rendered in a portal so a
 * transformed/clickable ancestor (e.g. an exercise card) never traps or receives its events.
 */
export function MediaSheet({ exKey, label, query, initialMode, onClose }: MediaSheetProps) {
  const pin = usePin(exKey)
  const [mode, setMode] = useState<MediaSheetMode>(initialMode)
  const [confirming, setConfirming] = useState(false)
  const media = useMemo(() => (pin ? parseMediaUrl(pin.url) : null), [pin])
  const viewing = pin && media && mode === 'view' ? { pin, media } : null

  // Opened straight into the editor -> close when done; opened from the viewer -> back to it.
  const afterEdit = () => (initialMode === 'edit' || !pin ? onClose() : setMode('view'))

  const remove = () => {
    if (!pin) return
    const previous = pin.url
    setPin(exKey, null)
    toast(`Media rimosso da “${label}”.`, {
      action: { label: 'Annulla', run: () => setPin(exKey, previous) },
      durationMs: 6000,
    })
    onClose()
  }

  const title = viewing ? label : pin ? 'Cambia video o GIF' : 'Fissa un video o una GIF'

  return createPortal(
    <div
      className="md-portal"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Escape must reach the Sheet's document listener.
        if (e.key !== 'Escape') e.stopPropagation()
      }}
    >
      <Sheet open title={title} onClose={onClose}>
        {!viewing ? (
          <div className="stack">
            <p className="md-for small">
              <IconPin /> <span>{label}</span>
            </p>
            <PinEditor
              exKey={exKey}
              label={label}
              query={query}
              initialUrl={pin?.url ?? ''}
              onSaved={afterEdit}
              onCancel={afterEdit}
            />
          </div>
        ) : (
          <div className="md-sheet stack">
            <MediaView media={viewing.media} title={label} rawUrl={viewing.pin.url} />

            <div className="md-sheet__links">
              <a className="btn btn--outline" href={youtubeSearchUrl(query)} target="_blank" rel="noopener noreferrer">
                <IconVideo /> Cerca su YouTube <IconExternal />
              </a>
              {viewing.media.type === 'youtube' && (
                <a className="btn btn--outline" href={viewing.media.watchUrl} target="_blank" rel="noopener noreferrer">
                  Apri su YouTube <IconExternal />
                </a>
              )}
            </div>

            {confirming ? (
              <div className="banner banner--danger stack-sm" role="alert">
                <p>
                  Rimuovere il media fissato per <strong>{label}</strong>? Il pulsante Video tornerà alla ricerca
                  su YouTube.
                </p>
                <div className="md-sheet__actions">
                  <button type="button" className="btn" onClick={() => setConfirming(false)}>
                    Annulla
                  </button>
                  <button type="button" className="btn btn--danger" onClick={remove}>
                    <IconTrash /> Sì, rimuovi
                  </button>
                </div>
              </div>
            ) : (
              <div className="md-sheet__actions">
                <button type="button" className="btn md-danger-text" onClick={() => setConfirming(true)}>
                  <IconTrash /> Rimuovi
                </button>
                <button type="button" className="btn btn--primary" onClick={() => setMode('edit')}>
                  <IconPin /> Cambia
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>,
    document.body,
  )
}
