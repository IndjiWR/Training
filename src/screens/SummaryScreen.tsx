import { useId, useMemo, useRef } from 'react'
import { IconCopy, IconExternal } from '../components/icons'
import { BackupControls } from '../components/shell/BackupControls'
import { routeHref } from '../components/shell/router'
import { formatShortDate, todayISO } from '../lib/date'
import { copyText } from '../lib/clipboard'
import { levelEmoji, levelLabel } from '../lib/elbow'
import { formatNumberIt, formatValue } from '../lib/format'
import {
  computeWeekSummary,
  formatWeekSummary,
  type SessionStatus,
  type SessionSummary,
  type TestResultSummary,
  type WeekSummary,
} from '../lib/summary'
import type { DayType, Plan } from '../plan/schema'
import { useAppData } from '../state/store'
import type { ElbowLevel } from '../state/types'
import { toast } from '../state/ui'
import './summary.css'

const STATUS_LABEL: Record<SessionStatus, string> = {
  done: 'Fatta',
  partial: 'Parziale',
  skipped: 'Saltata',
  planned: 'Da fare',
  rest: 'Riposo',
}

const STATUS_BADGE: Record<SessionStatus, string> = {
  done: 'badge badge--ok',
  partial: 'badge badge--warn',
  skipped: 'badge badge--danger',
  planned: 'badge sm-badge--planned',
  rest: 'badge sm-badge--rest',
}

const TYPE_LABEL: Record<DayType, string> = {
  TIRATA: 'Tirata',
  SPINTA: 'Spinta',
  GAMBE: 'Gambe',
  RIPOSO: 'Riposo',
}

const LEVEL_BADGE: Record<ElbowLevel, string> = {
  green: 'badge badge--ok',
  yellow: 'badge badge--warn',
  red: 'badge badge--danger',
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/* ───────────────────────── parts ───────────────────────── */

function LevelBadge({ level }: { level: ElbowLevel }) {
  return (
    <span className={LEVEL_BADGE[level]}>
      {levelEmoji(level)} {levelLabel(level)}
    </span>
  )
}

function Tiles({ counts }: { counts: WeekSummary['counts'] }) {
  const tiles: { key: string; label: string; value: number; tone: string }[] = [
    { key: 'done', label: 'Fatte', value: counts.done, tone: 'ok' },
    { key: 'partial', label: 'Parziali', value: counts.partial, tone: 'warn' },
    { key: 'skipped', label: 'Saltate', value: counts.skipped, tone: 'danger' },
    { key: 'planned', label: 'Da fare', value: counts.planned, tone: 'accent' },
  ]
  return (
    <ul className="sm-tiles" aria-label="Sessioni della settimana">
      {tiles.map((t) => (
        <li key={t.key} className="sm-tile" data-tone={t.tone}>
          <span className="sm-tile__value num">{t.value}</span>
          <span className="sm-tile__label">{t.label}</span>
        </li>
      ))}
    </ul>
  )
}

function sessionDetails(s: SessionSummary): string[] {
  const parts: string[] = []
  if (s.setsPlanned > 0 || s.setsDone > 0) parts.push(`serie ${s.setsDone}/${s.setsPlanned}`)
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`)
  if (s.elbowPre != null) parts.push(`gomito ${s.elbowPre}/10`)
  if (s.elbowDuring != null) parts.push(`durante ${s.elbowDuring}/10`)
  return parts
}

function SessionRow({ s }: { s: SessionSummary }) {
  const details = sessionDetails(s)
  const pct = s.setsPlanned > 0 ? Math.min(100, Math.round((s.setsDone / s.setsPlanned) * 100)) : 0
  return (
    <li className="sm-session" data-status={s.status}>
      <div className="sm-session__head">
        <span className="sm-session__date num">{formatShortDate(s.date)}</span>
        <span className={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</span>
      </div>
      <p className="sm-session__title">
        <span className="sm-session__type">{TYPE_LABEL[s.type]}</span>
        {s.title && <span> · {s.title}</span>}
      </p>
      {s.status !== 'rest' && s.setsPlanned > 0 && (
        <div className="sm-bar" aria-hidden="true">
          <span className="sm-bar__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(details.length > 0 || s.elbowLevel) && (
        <p className="small sm-session__details">
          {details.join(' · ')}
          {s.elbowLevel && (
            <>
              {details.length > 0 && ' '}
              <LevelBadge level={s.elbowLevel} />
            </>
          )}
        </p>
      )}
    </li>
  )
}

function formatTestValue(t: TestResultSummary, v: number | null): string {
  return v == null ? '–' : formatValue(v, t.unit)
}

function TestRow({ t }: { t: TestResultSummary }) {
  let main: string
  if (!t.recorded) main = 'non registrato'
  else if (t.dx != null || t.sx != null) main = `dx ${formatTestValue(t, t.dx)} · sx ${formatTestValue(t, t.sx)}`
  else if (t.value != null) main = formatTestValue(t, t.value)
  else main = t.text ? '' : 'registrato'
  const attempts = t.values.length > 1 ? `tentativi: ${t.values.map((v) => formatTestValue(t, v)).join(', ')}` : null
  return (
    <li className="sm-test" data-recorded={t.recorded}>
      <div className="sm-test__head">
        <span className="sm-test__name">{t.name}</span>
        <span className="small muted num">{formatShortDate(t.date)}</span>
      </div>
      <p className="sm-test__value">
        {main && <span className={t.recorded ? 'num' : 'faint'}>{main}</span>}
        {t.text && <span className="sm-test__text">{main ? ' · ' : ''}«{t.text}»</span>}
      </p>
      {attempts && <p className="small muted num">{attempts}</p>}
    </li>
  )
}

function Stats({ summary }: { summary: WeekSummary }) {
  return (
    <dl className="sm-stats">
      <div className="sm-stat">
        <dt>Gomito, massimo della settimana</dt>
        <dd>
          {summary.elbowMax != null ? (
            <>
              <span className="sm-stat__value num">{summary.elbowMax}/10</span>
              {summary.elbowMaxLevel && <LevelBadge level={summary.elbowMaxLevel} />}
            </>
          ) : (
            <span className="faint">n.d.</span>
          )}
        </dd>
      </div>
      <div className="sm-stat">
        <dt>Peso medio (mattina)</dt>
        <dd>
          {summary.weightAvg != null ? (
            <>
              <span className="sm-stat__value num">{formatNumberIt(summary.weightAvg)} kg</span>
              <span className="small muted">{plural(summary.weightCount, 'rilevazione', 'rilevazioni')}</span>
            </>
          ) : (
            <span className="faint">n.d.</span>
          )}
        </dd>
      </div>
      <div className="sm-stat">
        <dt>Sonno medio</dt>
        <dd>
          {summary.sleepAvg != null ? (
            <>
              <span className="sm-stat__value num">{formatNumberIt(summary.sleepAvg)} h</span>
              <span className="small muted">{plural(summary.sleepCount, 'notte', 'notti')}</span>
            </>
          ) : (
            <span className="faint">n.d.</span>
          )}
        </dd>
      </div>
    </dl>
  )
}

function CopyPanel({ text }: { text: string }) {
  const textId = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const share = canShare()
  const rows = Math.min(60, Math.max(6, text.split('\n').length + 1))

  const selectAll = () => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.select()
    el.scrollIntoView({ block: 'nearest' })
  }

  const copy = async () => {
    let ok = false
    try {
      ok = await copyText(text)
    } catch {
      ok = false
    }
    if (ok) {
      toast('Riepilogo copiato', { tone: 'success' })
    } else {
      selectAll()
      toast('Copia non riuscita: tieni premuto sul testo, «Seleziona tutto» e poi «Copia».', { tone: 'error' })
    }
  }

  const shareText = async () => {
    try {
      await navigator.share({ title: 'Riepilogo settimana', text })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      toast('Condivisione non riuscita: usa «Copia».', { tone: 'error' })
    }
  }

  return (
    <div className="stack-sm">
      <label htmlFor={textId} className="sm-label">
        Testo pronto da incollare in chat
      </label>
      <textarea
        id={textId}
        ref={ref}
        className="sm-text"
        readOnly
        value={text}
        rows={rows}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn btn--primary btn--big btn--block" onClick={() => void copy()}>
        <IconCopy />
        Copia
      </button>
      {share && (
        <button type="button" className="btn btn--outline btn--block" onClick={() => void shareText()}>
          <IconExternal />
          Condividi
        </button>
      )}
    </div>
  )
}

/* ───────────────────────── screens ───────────────────────── */

function BackupSection() {
  return (
    <section className="card stack-sm" aria-labelledby="sm-backup-title">
      <h2 id="sm-backup-title">Backup dati</h2>
      <BackupControls />
    </section>
  )
}

function EmptySummary() {
  return (
    <div className="sm-screen stack">
      <h1>Riepilogo settimana</h1>
      <section className="card stack sm-empty">
        <p>Nessuna scheda caricata: il riepilogo si costruisce sulla scheda della settimana.</p>
        <p className="small muted">Scarica la scheda da Google Drive o importa un file JSON in Impostazioni.</p>
        <a className="btn btn--primary btn--big btn--block" href={routeHref('impostazioni')}>
          Vai a Impostazioni
        </a>
      </section>
      <BackupSection />
    </div>
  )
}

function WeekSummaryView({ plan }: { plan: Plan }) {
  const sessions = useAppData((s) => s.sessions)
  const days = useAppData((s) => s.days)
  const today = todayISO()
  const summary = useMemo(
    () => computeWeekSummary({ plan, sessions, days, today }),
    [plan, sessions, days, today],
  )
  const text = useMemo(() => formatWeekSummary(summary), [summary])

  const quickCopy = async () => {
    let ok = false
    try {
      ok = await copyText(text)
    } catch {
      ok = false
    }
    if (ok) toast('Riepilogo copiato', { tone: 'success' })
    else toast('Copia non riuscita: usa il testo in fondo alla pagina e copialo a mano.', { tone: 'error' })
  }

  const title = summary.planTitle ?? plan.title ?? plan.id
  const range = summary.period ?? `${formatShortDate(summary.start)} – ${formatShortDate(summary.end)}`

  return (
    <div className="sm-screen stack">
      <header className="sm-head">
        <div className="sm-head__text">
          <h1>Riepilogo settimana</h1>
          <p className="sm-head__plan">{title}</p>
          <p className="small muted">{range}</p>
        </div>
        <button
          type="button"
          className="btn btn--outline btn--icon"
          aria-label="Copia il riepilogo"
          onClick={() => void quickCopy()}
        >
          <IconCopy />
        </button>
      </header>

      <Tiles counts={summary.counts} />

      <section className="card stack-sm" aria-labelledby="sm-sessions-title">
        <h2 id="sm-sessions-title">Sessioni</h2>
        {summary.sessions.length === 0 ? (
          <p className="muted">Nessun giorno in questa scheda.</p>
        ) : (
          <ul className="sm-list">
            {summary.sessions.map((s) => (
              <SessionRow key={s.date} s={s} />
            ))}
          </ul>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="sm-tests-title">
        <h2 id="sm-tests-title">Test</h2>
        {summary.tests.length === 0 ? (
          <p className="muted">Nessun test in questa scheda.</p>
        ) : (
          <ul className="sm-list">
            {summary.tests.map((t, i) => (
              <TestRow key={`${t.date}-${t.key}-${i}`} t={t} />
            ))}
          </ul>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="sm-stats-title">
        <h2 id="sm-stats-title">Gomito, peso e sonno</h2>
        <Stats summary={summary} />
      </section>

      <section className="card stack-sm" aria-labelledby="sm-notes-title">
        <h2 id="sm-notes-title">Note</h2>
        {summary.notes.length === 0 ? (
          <p className="muted">Nessuna nota.</p>
        ) : (
          <ul className="sm-list">
            {summary.notes.map((n, i) => (
              <li key={`${n.date}-${i}`} className="sm-note">
                <span className="small muted num">{formatShortDate(n.date)}</span>
                <p className="pre-line">{n.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="sm-text-title">
        <h2 id="sm-text-title">Check-in della domenica</h2>
        <CopyPanel text={text} />
      </section>

      <BackupSection />
    </div>
  )
}

export function SummaryScreen() {
  const plan = useAppData((s) => s.plan)
  if (!plan) return <EmptySummary />
  return <WeekSummaryView plan={plan} />
}
