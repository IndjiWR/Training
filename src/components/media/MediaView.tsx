import { useState } from 'react'
import { formatClock } from '../../lib/format'
import type { ParsedMedia, YouTubeMedia } from '../../lib/media'
import { IconExternal, IconPlay, IconWarning } from '../icons'
import { useOnline } from './hooks'
import './media.css'

const IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

/** youtube-nocookie player, 16:9. `autoplay` only right after a user tap. */
export function YouTubeEmbed({ media, title, autoplay = false }: { media: YouTubeMedia; title: string; autoplay?: boolean }) {
  return (
    <div className="md-frame">
      <iframe
        src={autoplay ? `${media.embedUrl}&autoplay=1` : media.embedUrl}
        title={title}
        loading="lazy"
        allow={IFRAME_ALLOW}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

/**
 * Click-to-load YouTube placeholder: no request to YouTube until tapped, so long lists never
 * mount dozens of iframes. Once loaded the player stays mounted (even if the signal drops).
 */
export function LiteYouTube({ media, title, compact = false }: { media: YouTubeMedia; title: string; compact?: boolean }) {
  const online = useOnline()
  const [loaded, setLoaded] = useState<string | null>(null)
  if (loaded === media.embedUrl) return <YouTubeEmbed media={media} title={`Video: ${title}`} autoplay />
  const start = media.start ? formatClock(media.start) : null
  return (
    <button
      type="button"
      className={compact ? 'md-lite md-lite--compact' : 'md-lite'}
      onClick={() => setLoaded(media.embedUrl)}
      disabled={!online}
      aria-label={
        online
          ? `Carica il video: ${title}${start ? `, inizio ${start}` : ''}`
          : `Video non disponibile offline: ${title}`
      }
    >
      <span className="md-lite__play" aria-hidden="true">
        <IconPlay />
      </span>
      <span className="md-lite__text">{online ? 'Carica video' : 'Offline: serve la connessione'}</span>
      <span className="md-lite__start num">{start ? `Inizio ${start}` : "Dall'inizio"}</span>
    </button>
  )
}

/** Pinned image/GIF with a readable fallback when it cannot be loaded. */
export function MediaImage({ url, alt, large = false }: { url: string; alt: string; large?: boolean }) {
  const online = useOnline()
  // Keyed on the connection state too: coming back online retries automatically.
  const attempt = `${online ? 'on' : 'off'}|${url}`
  const [failed, setFailed] = useState<string | null>(null)

  if (failed === attempt) {
    return (
      <div className="md-img-fallback" role="note">
        <IconWarning />
        <div className="stack-sm">
          <p>
            {online
              ? "Impossibile caricare l'immagine: il link deve puntare direttamente a un'immagine o GIF."
              : 'Sei offline e questa immagine non è ancora salvata sul telefono.'}
          </p>
          {online && (
            <div className="row">
              <button type="button" className="btn btn--outline" onClick={() => setFailed(null)}>
                Riprova
              </button>
              <a className="btn btn--ghost" href={url} target="_blank" rel="noopener noreferrer">
                Apri il link <IconExternal />
              </a>
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <img
      key={attempt}
      className={large ? 'md-img md-img--large' : 'md-img'}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(attempt)}
    />
  )
}

function InvalidPin({ reason, rawUrl }: { reason: string; rawUrl?: string }) {
  return (
    <div className="banner banner--danger md-invalid" role="note">
      <p>
        <strong>Link fissato non valido.</strong> {reason}
      </p>
      {rawUrl && <p className="md-url tiny">{rawUrl}</p>}
    </div>
  )
}

/**
 * Full view (sheet): YouTube player right away (the sheet opens on a tap), offline note when
 * there is no connection; image/GIF at full width.
 */
export function MediaView({ media, title, rawUrl }: { media: ParsedMedia; title: string; rawUrl?: string }) {
  const online = useOnline()
  // Mount the player as soon as we are online and keep it mounted afterwards.
  const [started, setStarted] = useState(online)
  if (online && !started) setStarted(true)

  if (media.type === 'invalid') return <InvalidPin reason={media.reason} rawUrl={rawUrl} />
  if (media.type === 'image') return <MediaImage url={media.url} alt={`Immagine: ${title}`} large />
  if (!started) {
    return (
      <div className="banner banner--warn md-offline" role="status">
        <p>
          <strong>📶 Sei offline.</strong> Per guardare il video serve la connessione: si caricherà da solo
          appena torna il segnale. Il link resta fissato.
        </p>
      </div>
    )
  }
  return <YouTubeEmbed media={media} title={`Video: ${title}`} autoplay />
}

/** Light preview for lists and the editor: compact click-to-load YouTube, lazy image. */
export function MediaPreview({ media, title, rawUrl }: { media: ParsedMedia; title: string; rawUrl?: string }) {
  if (media.type === 'invalid') return <InvalidPin reason={media.reason} rawUrl={rawUrl} />
  if (media.type === 'image') return <MediaImage url={media.url} alt={`Immagine: ${title}`} />
  return <LiteYouTube key={media.embedUrl} media={media} title={title} compact />
}
