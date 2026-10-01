import { useId, useState } from 'react'
import { copyText } from '../../lib/clipboard'
import { buildConnectionLink, parseConnection } from '../../lib/connection'
import { connectDrive, useSyncing } from '../../state/planSync'
import { toast } from '../../state/ui'
import { IconCopy, IconLink, IconPaste, IconRefresh, IconWarning } from '../icons'
import './connection.css'

/* ───────────────────────── Incolla collegamento ───────────────────────── */

/**
 * Reads the collegamento (…/exec?token=…) from the clipboard — on iPhone Safari asks with its
 * «Incolla» bubble — saves it and downloads the plan. When the clipboard cannot be read, a field
 * appears where the link can be pasted by hand.
 */
export function PasteLink({ prominent = true, label = 'Incolla collegamento' }: { prominent?: boolean; label?: string }) {
  const fieldId = useId()
  const hintId = useId()
  const errorId = useId()
  const syncing = useSyncing()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async (raw: string) => {
    const parsed = parseConnection(raw)
    if (!parsed.ok) {
      setError(parsed.error)
      setOpen(true)
      return
    }
    setError(null)
    setBusy(true)
    try {
      if ((await connectDrive(parsed.endpoint, parsed.token)) !== 'error') {
        setOpen(false)
        setText('')
      }
    } finally {
      setBusy(false)
    }
  }

  const fromClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setOpen(true)
      return
    }
    let clip: string
    try {
      clip = await navigator.clipboard.readText()
    } catch {
      // Refused or the «Incolla» bubble was dismissed: paste by hand in the field.
      setError(null)
      setOpen(true)
      return
    }
    await connect(clip)
  }

  return (
    <div className="cx-paste">
      <button
        type="button"
        className={prominent ? 'btn btn--primary btn--big btn--block' : 'btn btn--outline btn--block'}
        onClick={() => void fromClipboard()}
        disabled={busy || syncing}
        aria-busy={busy || undefined}
      >
        {busy ? <IconRefresh className="sh-spin" /> : <IconPaste />}
        {busy ? 'Collego…' : label}
      </button>

      {open && (
        <div className="field">
          <label htmlFor={fieldId}>Incolla qui il collegamento</label>
          <input
            id={fieldId}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="https://script.google.com/macros/s/…/exec?token=…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void connect(text)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          />
          <p id={hintId} className="small muted">
            Tieni premuto nel campo e scegli «Incolla».
          </p>
          {error && (
            <p id={errorId} role="alert" className="small cx-msg" data-level="error">
              <IconWarning aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!text.trim() || busy}
            onClick={() => void connect(text)}
          >
            Collega
          </button>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── Copia collegamento ───────────────────────── */

/** The saved collegamento, to copy (or share) towards the iPhone or another device. */
export function CopyLink({ endpoint, token }: { endpoint: string; token: string }) {
  let link: string
  try {
    link = buildConnectionLink(endpoint, token)
  } catch {
    return null
  }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    const ok = await copyText(link)
    toast(
      ok
        ? 'Collegamento copiato. Sull’iPhone: Training → Impostazioni → «Incolla collegamento».'
        : 'Copia non riuscita: riprova oppure usa «Condividi».',
      { tone: ok ? 'success' : 'error', durationMs: 7000 },
    )
  }

  const share = async () => {
    try {
      await navigator.share({ title: 'Collegamento Training', text: link })
    } catch {
      /* share sheet closed */
    }
  }

  return (
    <div className="stack-sm">
      <div className="cx-actions">
        <button type="button" className="btn btn--outline" onClick={() => void copy()}>
          <IconCopy />
          Copia collegamento
        </button>
        {canShare && (
          <button type="button" className="btn btn--outline" onClick={() => void share()}>
            <IconLink />
            Condividi
          </button>
        )}
      </div>
      <p className="small muted">
        Sull&apos;iPhone apri Training → Impostazioni → «Incolla collegamento». Con un Mac e lo stesso ID Apple il
        collegamento copiato qui è già negli appunti dell&apos;iPhone; altrimenti mandalo a te stesso (Note, Mail…) e
        copialo da lì. Contiene il token: non darlo ad altri.
      </p>
    </div>
  )
}
