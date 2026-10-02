import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { version as APP_VERSION } from '../../package.json'
import { IconCheck, IconChevronRight, IconRefresh, IconTrash, IconUpload, IconWarning } from '../components/icons'
import { BackupControls } from '../components/shell/BackupControls'
import { CopyLink, PasteLink } from '../components/shell/DriveLink'
import { errorText, exportBackup } from '../components/shell/backupActions'
import { ConfirmSheet } from '../components/shell/ConfirmSheet'
import { formatDateTime, formatDateTimeAgo } from '../components/shell/datetime'
import { splitEndpointToken } from '../components/shell/endpoint'
import { useOnline } from '../components/shell/online'
import { alertEnd, unlockAudio } from '../lib/feedback'
import { DATA_FILE_NAME } from '../lib/dataSync'
import { setSyncEnabled, updateSettings } from '../state/actions'
import {
  clearThisDevice,
  dataSyncActive,
  deleteLogsEverywhere,
  pendingCount,
  syncData,
  unreadableCount,
  useDataSyncing,
} from '../state/dataSync'
import { importPlanFile, loadExamplePlan, refreshPlan, useSyncing } from '../state/planSync'
import { getState, lastPersistFailed, useAppData } from '../state/store'
import type { PlanSource, ThemeName } from '../state/types'
import { stopRest, toast } from '../state/ui'
import './settings.css'

const SOURCE_LABEL: Record<PlanSource, string> = {
  remote: 'Google Drive',
  file: 'File importato',
  example: 'Esempio',
}

const SetupGuide = lazy(() => import('../components/shell/SetupGuide').then((m) => ({ default: m.SetupGuide })))

const DRIVE_SECTION_ID = 'st-drive'
const ENDPOINT_PLACEHOLDER = 'https://script.google.com/macros/s/…/exec'

/* ───────────────────────── helpers ───────────────────────── */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

type CheckLevel = 'ok' | 'warn' | 'error'

interface EndpointCheck {
  level: CheckLevel
  message: string | null
}

/** Shape check of the Apps Script /exec URL (the real test is "Aggiorna scheda"). */
function checkEndpoint(raw: string): EndpointCheck {
  const value = raw.trim()
  if (!value) return { level: 'ok', message: null }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return {
      level: 'error',
      message: "Non sembra un indirizzo valido: incolla l'URL completo, che inizia con https://",
    }
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) {
    return { level: 'error', message: "Serve un indirizzo sicuro che inizi con https://" }
  }
  if (url.searchParams.has('token')) {
    return {
      level: 'warn',
      message: "Al salvataggio «?token=…» viene tolto dall'URL: il token resta solo nel campo qui sotto.",
    }
  }
  if (/\/dev\/?$/.test(url.pathname)) {
    return {
      level: 'warn',
      message: "Questo è l'URL di prova (/dev), che funziona solo da loggato: usa quello che finisce con /exec.",
    }
  }
  if (!/\/exec\/?$/.test(url.pathname)) {
    return {
      level: 'warn',
      message: "Di solito l'URL della Web app finisce con /exec: controlla di averlo copiato per intero.",
    }
  }
  return { level: 'ok', message: null }
}

function scrollToSection(id: string, focusSelector?: string): void {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  if (focusSelector) el.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true })
}

async function runSafely(task: () => Promise<unknown>, failure: string): Promise<void> {
  try {
    await task()
  } catch (err) {
    toast(`${failure}\n${errorText(err)}`, { tone: 'error' })
  }
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section id={id} className="card st-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  )
}

/* ───────────────────────── a) Scheda attuale ───────────────────────── */

function PlanSection() {
  const plan = useAppData((s) => s.plan)
  const meta = useAppData((s) => s.planMeta)
  const endpoint = useAppData((s) => s.settings.endpoint)
  const token = useAppData((s) => s.settings.token)
  const syncing = useSyncing()
  const online = useOnline()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'file' | 'example' | null>(null)
  const [confirmExample, setConfirmExample] = useState(false)

  const configured = endpoint.trim() !== '' && token.trim() !== ''
  const canRefresh = configured && online && !syncing

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = '' // allow importing the same file again
    if (!file) return
    setBusy('file')
    await runSafely(() => importPlanFile(file), 'Importazione della scheda non riuscita.')
    setBusy(null)
  }

  const applyExample = async () => {
    setConfirmExample(false)
    setBusy('example')
    await runSafely(() => loadExamplePlan(), 'Caricamento della scheda di esempio non riuscito.')
    setBusy(null)
  }

  const askExample = () => {
    if (plan && (meta.source === 'remote' || meta.source === 'file')) setConfirmExample(true)
    else void applyExample()
  }

  const cancelExample = useCallback(() => setConfirmExample(false), [])

  return (
    <Section title="Scheda attuale">
      {plan ? (
        <div className="stack-sm">
          <p className="st-plan-title">{plan.title ?? 'Scheda senza titolo'}</p>
          {plan.period && <p className="muted">{plan.period}</p>}
          <dl className="st-facts">
            <div>
              <dt>ID</dt>
              <dd className="num">{plan.id}</dd>
            </div>
            <div>
              <dt>Generata</dt>
              <dd>{formatDateTime(plan.generated_at)}</dd>
            </div>
            <div>
              <dt>Origine</dt>
              <dd>{meta.source ? SOURCE_LABEL[meta.source] : '—'}</dd>
            </div>
            <div>
              <dt>Ricevuta</dt>
              <dd>{formatDateTimeAgo(meta.receivedAt)}</dd>
            </div>
            <div>
              <dt>Ultimo controllo</dt>
              <dd>{meta.lastCheckAt ? formatDateTimeAgo(meta.lastCheckAt) : 'mai'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="muted">
          Nessuna scheda salvata. Collega Google Drive qui sotto, importa un file JSON oppure prova la scheda di
          esempio.
        </p>
      )}

      {meta.lastError && (
        <div className="banner banner--danger st-error">
          <p className="st-error__title">
            <IconWarning aria-hidden="true" />
            Ultimo aggiornamento non riuscito
          </p>
          <p className="small pre-line st-error__text">{meta.lastError}</p>
          {plan && (
            <p className="small">
              <strong>Nessun problema per l&apos;allenamento:</strong> continuo a usare la scheda salvata.
            </p>
          )}
        </div>
      )}

      <div className="stack-sm">
        <button
          type="button"
          className="btn btn--primary btn--big btn--block"
          onClick={() => void runSafely(() => refreshPlan({ manual: true }), 'Aggiornamento non riuscito.')}
          disabled={!canRefresh}
          aria-busy={syncing || undefined}
        >
          <IconRefresh className={syncing ? 'sh-spin' : undefined} />
          {syncing ? 'Aggiornamento…' : 'Aggiorna scheda'}
        </button>
        {!configured ? (
          <p className="small muted">
            Per scaricare la scheda da Google Drive serve il{' '}
            <button
              type="button"
              className="st-link"
              onClick={() => scrollToSection(DRIVE_SECTION_ID, 'button')}
            >
              collegamento Google Drive
            </button>
            .
          </p>
        ) : !online ? (
          <p className="small muted">
            Sei offline: la scheda salvata funziona lo stesso. Si aggiorna da sola quando torna la rete.
          </p>
        ) : null}

        <div className="st-buttons">
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            aria-busy={busy === 'file' || undefined}
          >
            <IconUpload />
            {busy === 'file' ? 'Importo…' : 'Importa file JSON'}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={askExample}
            disabled={busy !== null}
            aria-busy={busy === 'example' || undefined}
          >
            {busy === 'example' ? 'Carico…' : 'Usa scheda di esempio'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>

      <ConfirmSheet
        open={confirmExample}
        title="Usare la scheda di esempio?"
        confirmLabel="Usa l'esempio"
        onConfirm={() => void applyExample()}
        onCancel={cancelExample}
      >
        <p>
          La scheda attuale{plan?.title ? ` («${plan.title}»)` : ''}
          {meta.source === 'remote' ? ', scaricata da Google Drive,' : ''} verrà sostituita da quella di esempio.
        </p>
        <p className="small muted">
          Sessioni, diario e media fissati restano. Per riavere la scheda di Drive usa «Aggiorna scheda».
        </p>
      </ConfirmSheet>
    </Section>
  )
}

/* ───────────────────────── b) Collegamento Google Drive ───────────────────────── */

/** Desktop-like pointer: the guided setup (done on a computer) starts open there. */
function isComputer(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)
}

function DriveSection() {
  const endpoint = useAppData((s) => s.settings.endpoint)
  const token = useAppData((s) => s.settings.token)
  const configured = endpoint.trim() !== '' && token.trim() !== ''
  const [guideOpen] = useState(() => !configured && isComputer())
  // The guide (with the script text) is loaded only once its section is opened, then kept.
  const [guideShown, setGuideShown] = useState(guideOpen)

  return (
    <Section id={DRIVE_SECTION_ID} title="Collegamento Google Drive">
      <p className="small">
        {configured ? (
          <span className="badge badge--ok">
            <IconCheck aria-hidden="true" className="st-badge-icon" />
            Collegato
          </span>
        ) : (
          <span className="badge">Non collegato</span>
        )}
      </p>

      {configured ? (
        <>
          <p className="small muted">
            La scheda si scarica da sola quando apri l&apos;app e quando torna la connessione.
          </p>
          <DataSyncPanel />
          <CopyLink endpoint={endpoint} token={token} />
          <PasteLink prominent={false} label="Incolla un nuovo collegamento" />
        </>
      ) : (
        <>
          <p className="small">
            <strong>Sull&apos;iPhone:</strong> copia il collegamento creato dal computer e tocca il pulsante.
          </p>
          <PasteLink />
        </>
      )}

      <details
        className="cx-details"
        open={guideOpen}
        onToggle={(e) => {
          if (e.currentTarget.open) setGuideShown(true)
        }}
      >
        <summary>
          <IconChevronRight aria-hidden="true" />
          Crea il collegamento dal computer
        </summary>
        <div className="cx-details__body">
          {guideShown && (
            <Suspense fallback={<p className="small muted">Carico la guida…</p>}>
              <SetupGuide />
            </Suspense>
          )}
        </div>
      </details>

      <details className="cx-details">
        <summary>
          <IconChevronRight aria-hidden="true" />
          Inserisci URL e token a mano
        </summary>
        <div className="cx-details__body">
          <ConnectionSection />
        </div>
      </details>

      <p className="small muted">
        URL e token restano solo su questo dispositivo: mai nel codice dell&apos;app né nel backup.
      </p>
    </Section>
  )
}

/** Saving of the logs on Drive: on/off, status, "Sincronizza ora". */
function DataSyncPanel() {
  const enabled = useAppData((s) => s.sync.enabled)
  const lastSyncAt = useAppData((s) => s.sync.lastSyncAt)
  const lastError = useAppData((s) => s.sync.lastError)
  const unreadable = useAppData((s) => unreadableCount(s))
  const pending = useAppData((s) => pendingCount(s))
  const syncing = useDataSyncing()
  const online = useOnline()

  const status = syncing
    ? lastSyncAt
      ? 'Sincronizzo con Drive…'
      : 'Unisco i dati di questo dispositivo con quelli su Drive…'
    : lastError
      ? 'Ultimo salvataggio non riuscito'
      : lastSyncAt
        ? `✓ Salvati su Drive · ${formatDateTimeAgo(lastSyncAt)}`
        : 'Non ancora sincronizzati'

  return (
    <div className="stack-sm">
      <ToggleRow
        label="Salva i dati su Google Drive"
        description={`Sessioni, diario e media fissati vanno nel file ${DATA_FILE_NAME} della cartella delle schede: non dipendono da questo browser e arrivano da soli sugli altri dispositivi collegati.`}
        pressed={enabled}
        onToggle={() => setSyncEnabled(!enabled)}
      />
      {enabled && (
        <>
          <p className="small" role="status">
            <strong>{status}</strong>
            {!syncing && pending > 0 && (
              <span className="muted">
                {' '}
                · {plural(pending, 'modifica da salvare', 'modifiche da salvare')}
              </span>
            )}
          </p>
          {lastError && <p className="banner banner--danger small pre-line">{lastError}</p>}
          {unreadable > 0 && (
            <p className="small muted">
              {plural(unreadable, 'elemento', 'elementi')} su Drive {unreadable === 1 ? 'viene' : 'vengono'} da una
              versione più recente dell&apos;app: aggiornala per vederli. Finché non la aggiorni, le modifiche a quei
              giorni restano solo qui.
            </p>
          )}
          <button
            type="button"
            className="btn btn--outline btn--block"
            disabled={syncing || !online}
            aria-busy={syncing || undefined}
            onClick={() => void syncData({ manual: true })}
          >
            <IconRefresh className={syncing ? 'sh-spin' : undefined} />
            {syncing ? 'Sincronizzo…' : 'Sincronizza ora'}
          </button>
          {!online && (
            <p className="small muted">
              Sei offline: le modifiche restano sul telefono e vanno su Drive quando torna la connessione.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ConnectionSection() {
  const endpoint = useAppData((s) => s.settings.endpoint)
  const token = useAppData((s) => s.settings.token)
  // Remount the form when the saved values change (save, backup import, other tab).
  return <ConnectionForm key={`${endpoint}\n${token}`} endpoint={endpoint} token={token} />
}

function ConnectionForm({ endpoint, token }: { endpoint: string; token: string }) {
  const urlId = useId()
  const urlMsgId = useId()
  const tokenId = useId()
  const tokenMsgId = useId()
  const [url, setUrl] = useState(endpoint)
  const [tok, setTok] = useState(token)
  const [showToken, setShowToken] = useState(false)
  const syncing = useSyncing()
  const online = useOnline()

  const urlTrim = url.trim()
  const tokTrim = tok.trim()
  const check = checkEndpoint(urlTrim)
  // What gets saved: a token pasted inside the URL never stays in the endpoint (it would reach
  // backups); it fills the token field when that is empty.
  const pasted = splitEndpointToken(urlTrim)
  const nextUrl = pasted.endpoint
  const nextTok = tokTrim || pasted.token || ''
  const dirty = nextUrl !== endpoint || nextTok !== token
  const invalid = check.level === 'error'
  const tokenMissing = urlTrim !== '' && nextTok === ''

  const persist = () => {
    // The form may not remount (same saved values): show what was saved.
    setUrl(nextUrl)
    setTok(nextTok)
    updateSettings({ endpoint: nextUrl, token: nextTok })
  }

  const save = () => {
    if (invalid || !dirty) return
    persist()
    toast('Collegamento salvato su questo dispositivo.', { tone: 'success' })
  }

  const saveAndRefresh = async (e?: FormEvent) => {
    e?.preventDefault()
    if (invalid) return
    if (dirty) persist()
    if (!nextUrl || !nextTok) {
      toast('Inserisci URL e token per scaricare la scheda.', { tone: 'warn' })
      return
    }
    if (!online) {
      toast('Salvato. Sei offline: la scheda si aggiorna da sola quando torna la rete.', { tone: 'info' })
      return
    }
    await runSafely(() => refreshPlan({ manual: true }), 'Aggiornamento non riuscito.')
  }

  return (
    <form className="stack" onSubmit={(e) => void saveAndRefresh(e)} noValidate>
      <div className="field">
        <label htmlFor={urlId}>URL della Web app (Apps Script)</label>
        <input
          id={urlId}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder={ENDPOINT_PLACEHOLDER}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={check.message ? urlMsgId : undefined}
        />
        {check.message && (
          <p id={urlMsgId} className="small st-check" data-level={check.level}>
            <IconWarning aria-hidden="true" />
            <span>{check.message}</span>
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={tokenId}>Token</label>
        <div className="st-token">
          <input
            id={tokenId}
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            aria-describedby={tokenMissing ? tokenMsgId : undefined}
          />
          <button
            type="button"
            className="btn btn--outline st-token__toggle"
            aria-pressed={showToken}
            aria-controls={tokenId}
            onClick={() => setShowToken((v) => !v)}
          >
            {showToken ? 'Nascondi' : 'Mostra'}
          </button>
        </div>
        {tokenMissing && (
          <p id={tokenMsgId} className="small st-check" data-level="warn">
            <IconWarning aria-hidden="true" />
            <span>Manca il token: senza, il server risponde «unauthorized».</span>
          </p>
        )}
      </div>

      {dirty && <p className="small st-dirty">Modifiche non salvate</p>}

      <div className="st-buttons">
        <button type="button" className="btn btn--outline" onClick={save} disabled={invalid || !dirty}>
          Salva
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={invalid || syncing}
          aria-busy={syncing || undefined}
        >
          <IconRefresh className={syncing ? 'sh-spin' : undefined} />
          Salva e aggiorna
        </button>
      </div>
    </form>
  )
}

/* ───────────────────────── c) Preferenze ───────────────────────── */

function ToggleRow({
  label,
  description,
  pressed,
  onToggle,
}: {
  label: string
  description: string
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" className="st-toggle" aria-pressed={pressed} onClick={onToggle}>
      <span className="st-toggle__text">
        <span className="st-toggle__label">{label}</span>
        <span className="st-toggle__desc">{description}</span>
      </span>
      <span className="st-toggle__state" aria-hidden="true">
        {pressed ? 'Sì' : 'No'}
      </span>
      <span className="st-switch" aria-hidden="true">
        <span className="st-switch__knob" />
      </span>
    </button>
  )
}

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'dark', label: 'Scuro' },
  { value: 'light', label: 'Sole (alto contrasto)' },
]

function PreferencesSection() {
  const theme = useAppData((s) => s.settings.theme)
  const sound = useAppData((s) => s.settings.sound)
  const vibration = useAppData((s) => s.settings.vibration)
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

  const testAlert = () => {
    try {
      unlockAudio()
      alertEnd()
    } catch (err) {
      toast(`Avviso non riuscito.\n${errorText(err)}`, { tone: 'error' })
      return
    }
    if (!sound && (!vibration || !canVibrate)) {
      toast('Suono e vibrazione sono disattivati: attivane almeno uno per sentire la fine del recupero.', {
        tone: 'warn',
      })
    }
  }

  return (
    <Section title="Preferenze">
      <div className="stack-sm">
        <span className="st-label" id="st-theme-label">
          Tema
        </span>
        <div className="st-chips" role="group" aria-labelledby="st-theme-label">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              className="chip st-chip"
              aria-pressed={theme === t.value}
              onClick={() => updateSettings({ theme: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stack-sm">
        <ToggleRow
          label="Suono"
          description="Bip a fine recupero e a fine timer. Su iPhone non si sente con il silenzioso attivo."
          pressed={sound}
          onToggle={() => updateSettings({ sound: !sound })}
        />
        <ToggleRow
          label="Vibrazione"
          description={
            canVibrate
              ? 'Vibra a fine recupero e a fine timer.'
              : 'Questo browser non supporta la vibrazione (es. iPhone): resta il suono.'
          }
          pressed={vibration}
          onToggle={() => updateSettings({ vibration: !vibration })}
        />
      </div>

      <button type="button" className="btn btn--block" onClick={testAlert}>
        Prova avviso
      </button>
    </Section>
  )
}

/* ───────────────────────── e) Dati ───────────────────────── */

function useStoragePersistence(): { supported: boolean; persisted: boolean | null; request: () => Promise<void> } {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  const supported = Boolean(storage && typeof storage.persist === 'function' && typeof storage.persisted === 'function')
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!supported || !storage) return
    let alive = true
    storage
      .persisted()
      .then((v) => {
        if (alive) setPersisted(v)
      })
      .catch(() => {
        if (alive) setPersisted(null)
      })
    return () => {
      alive = false
    }
  }, [supported, storage])

  const request = async () => {
    if (!supported || !storage) return
    try {
      const granted = await storage.persist()
      setPersisted(granted)
      if (granted) toast('Protezione attiva: il browser non cancellerà i dati da solo.', { tone: 'success' })
      else
        toast(
          "Il browser non l'ha concessa. Installa l'app nella schermata Home, usala spesso ed esporta un backup ogni tanto.",
          { tone: 'warn', durationMs: 8000 },
        )
    } catch {
      toast('Richiesta non riuscita.', { tone: 'error' })
    }
  }

  return { supported, persisted, request }
}

type ClearScope = 'device' | 'everywhere'

function DataSection() {
  const sessions = useAppData((s) => s.sessions)
  const days = useAppData((s) => s.days)
  const pins = useAppData((s) => s.pins)
  const [confirm, setConfirm] = useState(false)
  const [scope, setScope] = useState<ClearScope>('device')
  const [busy, setBusy] = useState(false)
  const persistence = useStoragePersistence()
  const writeFailed = lastPersistFailed()
  const syncOn = useAppData((s) => dataSyncActive(s))
  const unsaved = useAppData((s) => pendingCount(s))
  const online = useOnline()
  const everywhere = syncOn && scope === 'everywhere'

  const counts = [
    plural(Object.keys(sessions).length, 'sessione', 'sessioni'),
    plural(Object.keys(days).length, 'giorno di diario', 'giorni di diario'),
    plural(Object.keys(pins).length, 'media fissato', 'media fissati'),
  ].join(' · ')

  const cancel = useCallback(() => setConfirm(false), [])

  const clearEverywhere = async () => {
    setBusy(true)
    const outcome = await deleteLogsEverywhere()
    setBusy(false)
    if (outcome === 'unreachable') {
      toast('Google Drive non raggiungibile: non ho cancellato nulla. Riprova con la connessione.', {
        tone: 'error',
      })
      return
    }
    stopRest()
    setConfirm(false)
    toast(
      outcome === 'done'
        ? 'Dati cancellati qui e su Google Drive. Gli altri dispositivi li cancellano alla prossima sincronizzazione.'
        : 'Dati cancellati qui: su Google Drive appena la connessione lo permette.',
      { tone: 'success', durationMs: 7000 },
    )
  }

  const afterClear = () => {
    stopRest()
    setConfirm(false)
    const { endpoint, token } = getState().settings
    if (syncOn) {
      // The copy on Drive is untouched: bring it back now.
      toast('Dati cancellati da questo dispositivo: li riprendo da Google Drive.', { tone: 'success' })
      void refreshPlan({ manual: false })
      void syncData()
      return
    }
    toast('Dati cancellati. Collegamento e preferenze sono rimasti.', {
      tone: 'success',
      action:
        endpoint && token
          ? {
              label: 'Scarica scheda',
              run: () => void runSafely(() => refreshPlan({ manual: true }), 'Aggiornamento non riuscito.'),
            }
          : undefined,
      durationMs: 7000,
    })
  }

  const clearDevice = async () => {
    setBusy(true)
    const outcome = await clearThisDevice()
    setBusy(false)
    if (outcome === 'unsaved') {
      toast(
        'Alcune modifiche non sono ancora su Google Drive e andrebbero perse: non ho cancellato nulla. Riprova con la connessione, oppure esporta prima un backup.',
        { tone: 'error', durationMs: 10_000 },
      )
      return
    }
    afterClear()
  }

  const clear = () => {
    if (everywhere) void clearEverywhere()
    else void clearDevice()
  }

  return (
    <Section title="Dati">
      <p className="small">
        <strong>Su questo dispositivo:</strong> {counts}
      </p>

      {writeFailed && (
        <p className="banner banner--danger small" role="alert">
          Il salvataggio sul dispositivo non riesce (memoria piena, navigazione privata o dati dei siti bloccati
          dal browser): chiudendo l&apos;app perderesti le ultime modifiche. Esporta subito un backup.
        </p>
      )}

      {persistence.supported && (
        <div className="st-persist">
          <p className="small">
            <strong>Protezione dalla pulizia del browser:</strong>{' '}
            {persistence.persisted == null ? '…' : persistence.persisted ? 'attiva' : 'non attiva'}
          </p>
          {persistence.persisted === false && (
            <button type="button" className="btn btn--outline btn--block" onClick={() => void persistence.request()}>
              Chiedi di non cancellare i dati
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={() => {
          setScope('device')
          setConfirm(true)
        }}
      >
        <IconTrash />
        Cancella tutti i dati
      </button>

      <ConfirmSheet
        open={confirm}
        title="Cancellare tutti i dati?"
        confirmLabel={busy ? 'Cancello…' : everywhere ? 'Cancella ovunque' : syncOn ? 'Cancella da questo dispositivo' : 'Cancella tutto'}
        tone="danger"
        busy={busy}
        onConfirm={clear}
        onCancel={cancel}
      >
        {syncOn && (
          <div className="stack-sm">
            <span className="st-label" id="st-clear-scope">
              Da dove?
            </span>
            <div className="st-chips" role="group" aria-labelledby="st-clear-scope">
              <button
                type="button"
                className="chip st-chip"
                aria-pressed={scope === 'device'}
                disabled={busy}
                onClick={() => setScope('device')}
              >
                Solo da questo dispositivo
              </button>
              <button
                type="button"
                className="chip st-chip"
                aria-pressed={scope === 'everywhere'}
                disabled={busy || (!online && scope !== 'everywhere')}
                onClick={() => setScope('everywhere')}
              >
                Anche da Google Drive
              </button>
            </div>
          </div>
        )}
        {everywhere ? (
          <>
            <p>
              Sessioni, diario e media fissati ({counts}) verranno cancellati da questo dispositivo, dal file{' '}
              {DATA_FILE_NAME} su Google Drive e dagli altri dispositivi collegati alla loro prossima sincronizzazione.
              Restano la scheda, il collegamento e le preferenze.
            </p>
            <p className="small muted">
              Le modifiche fatte su un altro dispositivo e non ancora salvate su Drive restano lì.
            </p>
            {!online && <p className="small">Sei offline: per cancellare anche da Drive serve la connessione.</p>}
          </>
        ) : (
          <>
            <p>
              Verranno cancellati da questo dispositivo sessioni, diario, scheda e media fissati ({counts}). Restano il
              collegamento a Google Drive e le preferenze.
            </p>
            {syncOn && (
              <p className="small">
                {unsaved > 0
                  ? `Prima salvo su Google Drive ${unsaved === 1 ? 'la modifica non ancora salvata' : `le ${unsaved} modifiche non ancora salvate`}. `
                  : ''}
                La copia su Google Drive non viene toccata: subito dopo i dati tornano su questo dispositivo (utile se
                qui qualcosa non torna). Per ripartire da zero scegli «Anche da Google Drive».
              </p>
            )}
          </>
        )}
        <p className="banner banner--warn small">Non si può annullare. Se vuoi conservarli, esporta prima un backup.</p>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => exportBackup()}>
          Esporta prima un backup
        </button>
      </ConfirmSheet>
    </Section>
  )
}

/* ───────────────────────── f) Info ───────────────────────── */

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone)
}

function InfoSection() {
  const installed = isStandalone()
  return (
    <Section title="Info">
      <p>
        <strong>Training</strong> <span className="muted">· versione {APP_VERSION}</span>
      </p>
      <p className="small muted">
        Scheda settimanale di calisthenics al parco: timer, contatori e diario. Funziona anche offline.
      </p>
      <p className="small">
        <strong>Dove sono i dati:</strong> sul dispositivo, così l&apos;app funziona anche offline. Con Google Drive
        collegato e «Salva i dati su Google Drive» attivo, sessioni, diario e media fissati sono anche nel file{' '}
        {DATA_FILE_NAME} sul tuo Drive. Nessun altro server: la rete serve solo per Drive e per i video.
      </p>
      <p className="small muted">
        {installed
          ? 'App installata sulla schermata Home.'
          : "Consiglio: installa l'app sulla schermata Home (su iPhone: Condividi → Aggiungi alla schermata Home). Così si apre a tutto schermo e il browser non cancella i dati."}
      </p>
    </Section>
  )
}

/* ───────────────────────── screen ───────────────────────── */

export function SettingsScreen() {
  return (
    <div className="st-screen stack">
      <h1>Impostazioni</h1>
      <PlanSection />
      <DriveSection />
      <PreferencesSection />
      <Section title="Backup">
        <BackupControls />
      </Section>
      <DataSection />
      <InfoSection />
    </div>
  )
}
