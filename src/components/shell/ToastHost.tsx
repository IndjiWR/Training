import { useEffect, useRef, useState } from 'react'
import { dismissToast, useToasts, type Toast, type ToastTone } from '../../state/ui'
import { IconCheck, IconClose, IconWarning } from '../icons'

const TONE_LABEL: Record<ToastTone, string> = {
  info: 'Avviso',
  success: 'Fatto',
  warn: 'Attenzione',
  error: 'Errore',
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <IconCheck />
  if (tone === 'warn' || tone === 'error') return <IconWarning />
  return null
}

function ToastItem({ t }: { t: Toast }) {
  return (
    <div className="sh-toast" data-tone={t.tone}>
      <button
        type="button"
        className="sh-toast__body"
        onClick={() => dismissToast(t.id)}
        aria-label={`${TONE_LABEL[t.tone]}: ${t.message}. Tocca per chiudere.`}
      >
        <span className="sh-toast__icon" aria-hidden="true">
          <ToneIcon tone={t.tone} />
        </span>
        <span className="sh-toast__msg">{t.message}</span>
        <span className="sh-toast__close" aria-hidden="true">
          <IconClose />
        </span>
      </button>
      {t.action && (
        <button
          type="button"
          className="btn sh-toast__action"
          onClick={() => {
            t.action?.run()
            dismissToast(t.id)
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  )
}

interface Announcement {
  polite: string
  assertive: string
}

/**
 * Persistent live regions: only toasts that were just added are announced (errors as alerts),
 * so dismissing a toast never re-reads an older one.
 */
function useAnnouncements(toasts: Toast[]): Announcement {
  const [state, setState] = useState<Announcement>({ polite: '', assertive: '' })
  const lastId = useRef(0)
  const flip = useRef(false)

  useEffect(() => {
    const fresh = toasts.filter((t) => t.id > lastId.current)
    if (fresh.length === 0) return
    lastId.current = Math.max(...fresh.map((t) => t.id))
    // Alternate a trailing no-break space so that a repeated message is announced again.
    flip.current = !flip.current
    const suffix = flip.current ? ' ' : ''
    const error = fresh.filter((t) => t.tone === 'error').at(-1)
    const polite = fresh.filter((t) => t.tone !== 'error').at(-1)
    setState((prev) => ({
      polite: polite ? `${TONE_LABEL[polite.tone]}: ${polite.message}${suffix}` : prev.polite,
      assertive: error ? `${TONE_LABEL.error}: ${error.message}${suffix}` : prev.assertive,
    }))
  }, [toasts])

  return state
}

/** Toast stack at the top of the screen (below the status bar). Tap a toast to close it. */
export function ToastHost() {
  const toasts = useToasts()
  const announce = useAnnouncements(toasts)
  return (
    <>
      <div className="sh-toasts">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announce.polite}
      </div>
      <div className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {announce.assertive}
      </div>
    </>
  )
}
