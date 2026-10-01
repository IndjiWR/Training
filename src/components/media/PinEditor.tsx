import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { canonicalMediaUrl, describeMedia, parseMediaUrl, youtubeSearchUrl } from '../../lib/media'
import { setPin } from '../../state/actions'
import { toast } from '../../state/ui'
import { IconClose, IconExternal, IconPin, IconVideo } from '../icons'
import { MediaPreview } from './MediaView'
import './media.css'

export interface PinEditorProps {
  /** Library key the media is pinned to. */
  exKey: string
  /** Exercise label (toasts, previews). */
  label: string
  /** YouTube search query offered to find a video to pin. */
  query: string
  /** Current pinned URL, '' when nothing is pinned. */
  initialUrl?: string
  onSaved: () => void
  onCancel: () => void
}

const PREVIEW_DELAY_MS = 400
const TONE_ICON = { ok: '✓', warn: '⚠', error: '✗' } as const

function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
}

/** Form to pin a YouTube link or an image/GIF URL to a library key (live validation + preview). */
export function PinEditor({ exKey, label, query, initialUrl = '', onSaved, onCancel }: PinEditorProps) {
  const inputId = useId()
  const hintId = useId()
  const feedbackId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialUrl)
  const [previewText, setPreviewText] = useState(initialUrl)

  // Debounced preview: no image request for every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setPreviewText(text), PREVIEW_DELAY_MS)
    return () => clearTimeout(t)
  }, [text])

  const parsed = useMemo(() => (text.trim() ? parseMediaUrl(text) : null), [text])
  const debounced = useMemo(() => {
    if (!previewText.trim()) return null
    const m = parseMediaUrl(previewText)
    return m.type === 'invalid' ? null : m
  }, [previewText])
  // Never preview a stale URL while the current text is invalid.
  const preview = parsed && parsed.type !== 'invalid' ? debounced : null
  const feedback = parsed ? describeMedia(parsed) : null
  const canonical = parsed ? canonicalMediaUrl(parsed) : null
  const unchanged = canonical !== null && canonical === initialUrl

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canonical) {
      inputRef.current?.focus()
      return
    }
    if (!unchanged) {
      setPin(exKey, canonical)
      toast(`Media fissato per “${label}”.`, { tone: 'success' })
    }
    onSaved()
  }

  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      if (clip) {
        setText(clip)
        setPreviewText(clip)
      } else {
        toast('Gli appunti sono vuoti: copia prima il link.', { tone: 'warn' })
      }
    } catch {
      toast('Non riesco a leggere gli appunti: tieni premuto nel campo e scegli Incolla.', { tone: 'warn' })
      inputRef.current?.focus()
    }
  }

  return (
    <form className="md-editor stack" onSubmit={submit} noValidate>
      <p className="small muted" id={hintId}>
        Incolla il link di un video YouTube (va bene anche con <span className="md-code">&amp;t=</span> per partire
        da un punto preciso) oppure il link diretto di un’immagine o GIF.
      </p>

      <div className="field">
        <label htmlFor={inputId}>Link del video o dell’immagine</label>
        <div className="md-editor__input">
          <input
            ref={inputRef}
            id={inputId}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="https://youtu.be/…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${hintId} ${feedbackId}`}
            aria-invalid={feedback?.tone === 'error' ? true : undefined}
          />
          {text ? (
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Svuota il campo"
              onClick={() => {
                setText('')
                setPreviewText('')
                inputRef.current?.focus()
              }}
            >
              <IconClose />
            </button>
          ) : (
            canReadClipboard() && (
              <button type="button" className="btn btn--outline" onClick={paste}>
                Incolla
              </button>
            )
          )}
        </div>
        <p id={feedbackId} className="md-feedback small" data-tone={feedback?.tone} aria-live="polite">
          {feedback && (
            <>
              <span aria-hidden="true">{TONE_ICON[feedback.tone]} </span>
              {feedback.text}
            </>
          )}
        </p>
      </div>

      {preview && (
        <div className="md-editor__preview">
          <p className="tiny muted">Anteprima</p>
          <MediaPreview media={preview} title={label} />
        </div>
      )}

      <a
        className="btn btn--outline btn--block md-search"
        href={youtubeSearchUrl(query)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <IconVideo />
        <span className="md-search__text">Cerca “{query}” su YouTube</span>
        <IconExternal />
      </a>

      <div className="md-editor__actions">
        <button type="button" className="btn btn--big" onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className="btn btn--primary btn--big" disabled={!canonical}>
          <IconPin /> Salva
        </button>
      </div>
    </form>
  )
}
