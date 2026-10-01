import { useId, useState, type ReactNode } from 'react'
import codeGs from '../../../apps-script/Code.gs?raw'
import manifestJson from '../../../apps-script/appsscript.json?raw'
import { copyText } from '../../lib/clipboard'
import { buildConnectionLink, DEFAULT_FOLDER_ID, extractFolderId, generateToken, scriptWithSetup } from '../../lib/connection'
import { stripTokenParam } from '../../lib/sync'
import { connectDrive, useSyncing } from '../../state/planSync'
import { useAppData } from '../../state/store'
import { toast } from '../../state/ui'
import { IconCopy, IconExternal, IconRefresh, IconWarning } from '../icons'
import { CopyLink } from './DriveLink'
import './connection.css'

const PENDING_TOKEN_KEY = 'training:setup-token'

function readPendingToken(): string | null {
  try {
    return localStorage.getItem(PENDING_TOKEN_KEY)
  } catch {
    return null
  }
}

function writePendingToken(value: string | null): void {
  try {
    if (value) localStorage.setItem(PENDING_TOKEN_KEY, value)
    else localStorage.removeItem(PENDING_TOKEN_KEY)
  } catch {
    /* storage unavailable: the token lives only in this page */
  }
}

/** Token baked into the copied script: the saved one, else a pending one kept across reloads. */
function setupToken(saved: string): string {
  if (saved.trim()) return saved.trim()
  const pending = readPendingToken()
  if (pending) return pending
  const fresh = generateToken()
  writePendingToken(fresh)
  return fresh
}

function Step({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="cx-step" data-done={done || undefined}>
      <div className="cx-step__body">
        <span className="cx-step__title">
          {title}
          {done && <span className="visually-hidden"> (fatto)</span>}
        </span>
        {children}
      </div>
    </li>
  )
}

/**
 * One-time setup from a computer: copy the script (with folder and a fresh token), create it with
 * script.new, run setup, deploy, paste the /exec URL; then copy the collegamento for the iPhone.
 */
export function SetupGuide() {
  const savedEndpoint = useAppData((s) => s.settings.endpoint)
  const savedToken = useAppData((s) => s.settings.token)
  const syncing = useSyncing()
  const folderFieldId = useId()
  const urlFieldId = useId()
  const urlErrorId = useId()
  const [token] = useState(() => setupToken(savedToken))
  const [folderText, setFolderText] = useState(DEFAULT_FOLDER_ID)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [copied, setCopied] = useState({ code: false, manifest: false })
  const [busy, setBusy] = useState(false)

  const folderId = extractFolderId(folderText)
  const linked = savedEndpoint.trim() !== '' && savedToken.trim() === token

  const copy = async (what: 'code' | 'manifest') => {
    if (what === 'code' && !folderId) return
    const text = what === 'code' ? scriptWithSetup(codeGs, folderId ?? '', token) : manifestJson
    const ok = await copyText(text)
    if (ok) setCopied((c) => ({ ...c, [what]: true }))
    toast(ok ? (what === 'code' ? 'Codice copiato.' : 'Manifest copiato.') : 'Copia non riuscita: riprova.', {
      tone: ok ? 'success' : 'error',
    })
  }

  const saveAndTest = async () => {
    const endpoint = stripTokenParam(url)
    try {
      buildConnectionLink(endpoint, token)
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : String(err))
      return
    }
    setUrlError(null)
    setBusy(true)
    try {
      if ((await connectDrive(endpoint, token)) !== 'error') writePendingToken(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="small">
        Si fa una volta sola, dal computer: l&apos;editor di Apps Script dal telefono è scomodo. Alla fine copi un
        collegamento e lo incolli sull&apos;iPhone.
      </p>
      <ol className="cx-steps">
        <Step title="Cartella delle schede">
          <div className="field">
            <label htmlFor={folderFieldId}>Link o ID della cartella Drive</label>
            <input
              id={folderFieldId}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={folderText}
              onChange={(e) => setFolderText(e.target.value)}
              aria-invalid={folderId ? undefined : true}
            />
          </div>
          {!folderId && (
            <p className="small cx-msg" data-level="error">
              <IconWarning aria-hidden="true" />
              <span>Incolla il link della cartella (drive.google.com/drive/folders/…) oppure il suo ID.</span>
            </p>
          )}
        </Step>

        <Step title="Copia il codice dello script" done={copied.code}>
          <p className="small muted">Contiene la cartella e un token generato ora: è un segreto, non condividerlo.</p>
          <button type="button" className="btn btn--primary" disabled={!folderId} onClick={() => void copy('code')}>
            <IconCopy />
            Copia il codice
          </button>
        </Step>

        <Step title="Crea lo script">
          <a className="btn btn--outline" href="https://script.new" target="_blank" rel="noopener noreferrer">
            <IconExternal />
            Apri script.new
          </a>
          <p className="small">
            Si apre un progetto Apps Script nuovo con il tuo account Google. Seleziona tutto il testo di esempio,
            incolla il codice e salva (Ctrl+S o ⌘S).
          </p>
        </Step>

        <Step title="Permesso di sola lettura (consigliato)" done={copied.manifest}>
          <p className="small">
            In <strong>Impostazioni progetto</strong> (ingranaggio a sinistra) spunta «Mostra il file manifest
            "appsscript.json" nell&apos;editor». Torna all&apos;editor, apri <strong>appsscript.json</strong>, incolla al
            posto di tutto e salva.
          </p>
          <button type="button" className="btn btn--outline" onClick={() => void copy('manifest')}>
            <IconCopy />
            Copia il manifest
          </button>
        </Step>

        <Step title="Esegui «setup»">
          <p className="small">
            In alto scegli la funzione <strong>setup</strong> e premi <strong>Esegui</strong>. Autorizza con il tuo
            account; se compare «Google non ha verificato questa app» scegli{' '}
            <strong>Avanzate → Vai a … (non sicuro)</strong>: lo script è tuo. Nel log deve comparire «Pronto».
          </p>
        </Step>

        <Step title="Pubblica come applicazione web">
          <p className="small">
            <strong>Esegui il deployment → Nuovo deployment</strong> → ingranaggio → <strong>Applicazione web</strong>.
            Esegui come: <strong>Me</strong> · Chi può accedere: <strong>Chiunque</strong>. Premi Esegui il deployment e
            copia l&apos;URL dell&apos;applicazione web (finisce con <strong>/exec</strong>).
          </p>
        </Step>

        <Step title="Incolla l'URL e prova" done={linked}>
          <div className="field">
            <label htmlFor={urlFieldId}>URL dell&apos;applicazione web</label>
            <input
              id={urlFieldId}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://script.google.com/macros/s/…/exec"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(null)
              }}
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? urlErrorId : undefined}
            />
          </div>
          {urlError && (
            <p id={urlErrorId} role="alert" className="small cx-msg" data-level="error">
              <IconWarning aria-hidden="true" />
              <span>{urlError}</span>
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={!url.trim() || busy || syncing}
            aria-busy={busy || undefined}
            onClick={() => void saveAndTest()}
          >
            <IconRefresh className={busy ? 'sh-spin' : undefined} />
            {busy ? 'Provo…' : 'Salva e prova'}
          </button>
        </Step>

        <Step title="Collega l'iPhone">
          {linked ? (
            <CopyLink endpoint={savedEndpoint} token={savedToken} />
          ) : (
            <p className="small muted">Disponibile quando il passo precedente è riuscito.</p>
          )}
        </Step>
      </ol>
    </div>
  )
}
