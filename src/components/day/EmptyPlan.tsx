import { useId, useState, type ChangeEvent } from 'react'
import { useAppData } from '../../state/store'
import { importPlanFile, loadExamplePlan, refreshPlan, useSyncing } from '../../state/planSync'
import { toast } from '../../state/ui'
import { IconRefresh, IconSettings, IconUpload } from '../icons'
import './day.css'

/** "Oggi" without a plan: how to get one (settings, file import, bundled example). */
export function EmptyPlan() {
  const titleId = useId()
  const lastError = useAppData((s) => s.planMeta.lastError)
  const hasEndpoint = useAppData((s) => s.settings.endpoint.trim() !== '')
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
        Per allenarti serve la scheda della settimana. Inserisci in Impostazioni l'indirizzo dello script di Google
        Drive per scaricarla in automatico, oppure importa a mano il file <span className="num">scheda-AAAA-MM-GG.json</span>.
      </p>

      {lastError && (
        <div className="banner banner--danger" role="alert">
          <p>
            <strong>Ultimo errore</strong>
          </p>
          <p className="small pre-line">{lastError}</p>
        </div>
      )}

      <button
        type="button"
        className="btn btn--big btn--primary btn--block"
        onClick={() => {
          location.hash = '#/impostazioni'
        }}
      >
        <IconSettings />
        Apri Impostazioni
      </button>

      {hasEndpoint && (
        <button
          type="button"
          className="btn btn--outline btn--block"
          disabled={syncing}
          onClick={() => void refreshPlan({ manual: true })}
        >
          <IconRefresh />
          {syncing ? 'Scarico la scheda…' : 'Scarica la scheda'}
        </button>
      )}

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

      <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => void onExample()}>
        Prova con la scheda di esempio
      </button>
    </section>
  )
}
