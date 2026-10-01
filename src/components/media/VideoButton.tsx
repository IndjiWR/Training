import { useCallback, useState, type MouseEvent } from 'react'
import { youtubeSearchUrl } from '../../lib/media'
import { toast } from '../../state/ui'
import { IconPin, IconVideo } from '../icons'
import { isOnline, useLibraryEntry, usePin } from './hooks'
import { MediaSheet, type MediaSheetMode } from './MediaSheet'
import './media.css'

export interface VideoButtonProps {
  /** Library key of the exercise. */
  exKey: string
  /** Used for the YouTube search when library[exKey].video_query is null (e.g. exercise name). */
  fallbackQuery: string
  /** Compact variant for dense rows. */
  compact?: boolean
}

/**
 * "Video" button for every exercise. No pin: opens the YouTube search for library.video_query
 * (new tab) + a small pin button. Pinned: opens a sheet with the embedded YouTube
 * (youtube-nocookie, start time) or the image/GIF.
 */
export function VideoButton({ exKey, fallbackQuery, compact = false }: VideoButtonProps) {
  return <MediaButtons exKey={exKey} fallbackQuery={fallbackQuery} variant={compact ? 'compact' : 'default'} />
}

/**
 * - default / compact: "Video" + (no pin) an icon button to pin a media.
 * - card (Esercizi page): "Video" + a labelled "Fissa video/GIF" / "Cambia" button.
 */
export type MediaButtonsVariant = 'default' | 'compact' | 'card'

export interface MediaButtonsProps {
  exKey: string
  fallbackQuery: string
  variant?: MediaButtonsVariant
}

export function MediaButtons({ exKey, fallbackQuery, variant = 'default' }: MediaButtonsProps) {
  const lib = useLibraryEntry(exKey)
  const pin = usePin(exKey)
  const [sheet, setSheet] = useState<MediaSheetMode | null>(null)
  const close = useCallback(() => setSheet(null), [])

  const label = lib?.label || fallbackQuery.trim() || exKey
  const query = lib?.video_query?.trim() || fallbackQuery.trim() || label

  const onSearch = (e: MouseEvent<HTMLAnchorElement>) => {
    if (isOnline()) return
    e.preventDefault()
    toast('Sei offline: per cercare il video su YouTube serve la connessione.', { tone: 'warn' })
  }

  return (
    <div className={`md-buttons md-buttons--${variant}`}>
      {pin ? (
        <button
          type="button"
          className="btn md-video md-video--pinned"
          aria-haspopup="dialog"
          onClick={() => setSheet('view')}
        >
          <IconVideo />
          <span>Video</span>
          <IconPin className="md-video__pin" />
          <span className="visually-hidden">fissato: {label}</span>
        </button>
      ) : (
        <a className="btn md-video" href={youtubeSearchUrl(query)} target="_blank" rel="noopener noreferrer" onClick={onSearch}>
          <IconVideo />
          <span>Video</span>
          <span className="visually-hidden">: cerca “{query}” su YouTube (nuova scheda)</span>
        </a>
      )}

      {variant === 'card' ? (
        <button
          type="button"
          className="btn btn--outline md-pin-text"
          aria-haspopup="dialog"
          aria-label={pin ? `Cambia il media fissato di ${label}` : `Fissa video o GIF per ${label}`}
          onClick={() => setSheet('edit')}
        >
          <IconPin />
          {pin ? 'Cambia' : 'Fissa video'}
        </button>
      ) : (
        !pin && (
          <button
            type="button"
            className="btn btn--ghost btn--icon md-pin"
            aria-label="Fissa un video o una GIF"
            title="Fissa un video o una GIF"
            aria-haspopup="dialog"
            onClick={() => setSheet('edit')}
          >
            <IconPin />
          </button>
        )
      )}

      {sheet && <MediaSheet exKey={exKey} label={label} query={query} initialMode={sheet} onClose={close} />}
    </div>
  )
}
