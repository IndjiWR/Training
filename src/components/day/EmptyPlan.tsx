import { useId, useState, type ChangeEvent } from 'react'
import { useAppData } from '../../state/store'
import { importPlanFile, loadExamplePlan, refreshPlan, useSyncing } from '../../state/planSync'
import { toast } from '../../state/ui'
import { IconRefresh, IconSettings, IconUpload } from '../icons'
import { PasteLink } from '../shell/DriveLink'
import './day.css'

/** Where the app is published, without the protocol (e.g. "indjiwr.github.io/Training"). */
function appAddress(): string {
  if (typeof location === 'undefined') return ''
  return `${location.host}${import.meta.env.BASE_URL}`.replace(/\/$/, '')
}

/** "Oggi" without a plan: paste the Drive collegamento, or import a file, or try the example. */
export function EmptyPlan() {
  const titleId = useId()
  const lastError = useAppData((s) => s.planMeta.lastError)
  const linked = useAppData((s) => s.settings.endpoint.trim() !== '' && s.settings.token.trim() !== '')
  const syncing = useSyncing()
  const [busy, setBusy] = useState(false)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = '' // allow choosing the same file again
    if (!file) return
    setBusy(true)
    try {
      await importPlanFile(file)
    } catch {
      toast('Impossibile leggere il file della scheda.', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const onExample = async () => {
    setBusy(true)
    try {
      await loadExamplePlan()
    } catch {
      toast('Impossibile caricare la scheda di esempio.', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card dy-empty" aria-labelledby={titleId}>
      <h1 id={titleId}>Nessuna scheda</h1>
      <p className="muted">
        Per allenarti serve la scheda della settimana. Una volta collegata Google Drive, l&apos;app la scarica da
        sola ogni volta che la apri.
      </p>

      {lastError && (
        <div className="banner banner--danger" role="alert">
          <p>
            <strong>Ultimo errore</strong>
          </p>
          <p className="small pre-line">{lastError}</p>
        </div>
      )}

      {linked ? (
        <button
          type="button"
          className="btn btn--big btn--primary btn--block"
          disabled={syncing}
          onClick={() => void refreshPlan({ manual: true })}
        >
          <IconRefresh className={syncing ? 'sh-spin' : undefined} />
          {syncing ? 'Scarico la scheda…' : 'Scarica la scheda'}
        </button>
      ) : (
        <>
          <PasteLink />
          <p className="small muted">
            Il collegamento si crea una volta sola dal computer: apri <strong>{appAddress()}</strong> → Impostazioni →
            «Crea il collegamento dal computer».
          </p>
        </>
      )}

      <button
        type="button"
        className="btn btn--outline btn--block"
        onClick={() => {
          location.hash = '#/impostazioni'
        }}
      >
        <IconSettings />
        Apri Impostazioni
      </button>

      <label className="btn btn--outline btn--block dy-file" aria-disabled={busy || undefined}>
        <IconUpload />
        Importa file JSON
        <input
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => void onFile(e)}
        />
      </label>
      <p className="small muted">
        Su iPhone, con l&apos;app Google Drive installata, puoi sceglierlo direttamente da lì: Sfoglia → Drive.
      </p>

      <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => void onExample()}>
        Prova con la scheda di esempio
      </button>
    </section>
  )
}
