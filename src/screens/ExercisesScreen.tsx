import { memo, useId, useMemo, useState } from 'react'
import { IconChevronRight, IconClose, IconPin, IconSettings } from '../components/icons'
import { MediaPreview } from '../components/media/MediaView'
import { MediaButtons } from '../components/media/VideoButton'
import { formatShortDate } from '../lib/date'
import { unitLabel } from '../lib/format'
import { parseMediaUrl } from '../lib/media'
import type { LibraryEntry, Plan, Warmup } from '../plan/schema'
import { useAppData } from '../state/store'
import type { MediaPin } from '../state/types'
import './exercises.css'

/** One day of the current plan that uses a library key. */
interface DayUse {
  date: string
  /** How many times the key appears that day (e.g. two blocks of the same exercise). */
  count: number
  test: boolean
}

function buildUsage(plan: Plan): Map<string, DayUse[]> {
  const map = new Map<string, DayUse[]>()
  for (const day of plan.days) {
    for (const ex of day.exercises) {
      const list = map.get(ex.key) ?? []
      const same = list.find((u) => u.date === day.date)
      if (same) {
        same.count += 1
        same.test ||= ex.test
      } else {
        list.push({ date: day.date, count: 1, test: ex.test })
      }
      map.set(ex.key, list)
    }
  }
  return map
}

/** Lowercase without accents: "Mobilità" matches "mobilita". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function matches(tokens: readonly string[], ...fields: string[]): boolean {
  if (tokens.length === 0) return true
  const haystack = fold(fields.join(' '))
  return tokens.every((t) => haystack.includes(t))
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function measureText(measure: string): string {
  return measure === '0-10' ? 'dolore 0-10' : unitLabel(measure)
}

function countLabel(n: number): string {
  return n === 1 ? '1 esercizio' : `${n} esercizi`
}

/** Search query for keys that are no longer in the library: "front-lever-raise" -> "front lever raise". */
function keyToQuery(key: string): string {
  return key.replace(/[-_]+/g, ' ').trim() || key
}

export function ExercisesScreen() {
  const plan = useAppData((s) => s.plan)
  const pins = useAppData((s) => s.pins)
  const searchId = useId()
  const orphansId = useId()
  const [query, setQuery] = useState('')
  const [onlyPinned, setOnlyPinned] = useState(false)

  const usage = useMemo(() => (plan ? buildUsage(plan) : new Map<string, DayUse[]>()), [plan])
  const entries = useMemo(() => (plan ? Object.entries(plan.library) : []), [plan])
  const tokens = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query])

  // Pins with a usable URL (a hand-edited backup could contain anything).
  const pinnedKeys = useMemo(
    () => Object.keys(pins).filter((k) => typeof own(pins, k)?.url === 'string'),
    [pins],
  )
  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys])
  const orphanKeys = useMemo(
    () => pinnedKeys.filter((k) => !(plan && Object.hasOwn(plan.library, k))),
    [pinnedKeys, plan],
  )
  const pinnedInPlan = pinnedKeys.length - orphanKeys.length
  const pinnedOnly = onlyPinned && pinnedInPlan > 0

  const visible = entries.filter(
    ([key, entry]) => (!pinnedOnly || pinnedSet.has(key)) && matches(tokens, entry.label, key),
  )
  const visibleOrphans = orphanKeys.filter((key) => matches(tokens, key, keyToQuery(key)))
  const filtering = tokens.length > 0 || pinnedOnly

  const clearFilters = () => {
    setQuery('')
    setOnlyPinned(false)
  }

  return (
    <div className="exl stack">
      <header className="exl-head stack-sm">
        <div className="exl-head__title">
          <h1>Esercizi</h1>
          {plan && (
            <span className="exl-count num" aria-live="polite">
              {filtering ? `${visible.length} di ${entries.length}` : countLabel(entries.length)}
            </span>
          )}
        </div>
        {plan?.title && <p className="small muted">{plan.title}</p>}

        {plan && (
          <div className="exl-search" role="search">
            <label htmlFor={searchId} className="visually-hidden">
              Cerca esercizio
            </label>
            <svg className="exl-search__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              id={searchId}
              className="input"
              type="search"
              placeholder="Cerca per nome o chiave"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="btn btn--ghost btn--icon exl-search__clear"
                aria-label="Cancella ricerca"
                onClick={() => setQuery('')}
              >
                <IconClose />
              </button>
            )}
          </div>
        )}

        {plan && pinnedInPlan > 0 && (
          <div className="row">
            <button
              type="button"
              className="chip exl-chip"
              aria-pressed={pinnedOnly}
              onClick={() => setOnlyPinned(!pinnedOnly)}
            >
              📌 Solo con media ({pinnedInPlan})
            </button>
          </div>
        )}
      </header>

      {!plan ? (
        <section className="card exl-empty stack">
          <h2>Nessuna scheda caricata</h2>
          <p className="muted">
            Qui trovi tutti gli esercizi della scheda con i loro video. Collega la cartella di Google Drive o importa
            un file JSON da Impostazioni.
          </p>
          <a className="btn btn--primary btn--big btn--block" href="#/impostazioni">
            <IconSettings /> Vai a Impostazioni
          </a>
        </section>
      ) : entries.length === 0 ? (
        <p className="card muted">La scheda attuale non contiene esercizi in libreria.</p>
      ) : (
        <section className="stack" aria-label="Esercizi della scheda">
          {visible.map(([key, entry]) => (
            <LibraryCard
              key={key}
              exKey={key}
              entry={entry}
              uses={usage.get(key)}
              warmup={own(plan.warmups, key)}
              pin={own(pins, key)}
            />
          ))}
          {visible.length === 0 && visibleOrphans.length === 0 && (
            <div className="card exl-none stack-sm" role="status">
              <p className="muted">
                {tokens.length > 0
                  ? `Nessun esercizio trovato per “${query.trim()}”.`
                  : 'Nessun esercizio con media fissato.'}
              </p>
              <button type="button" className="btn btn--outline" onClick={clearFilters}>
                Mostra tutti
              </button>
            </div>
          )}
        </section>
      )}

      {visibleOrphans.length > 0 && (
        <section className="stack exl-orphans" aria-labelledby={orphansId}>
          <div className="stack-sm">
            <h2 id={orphansId}>Media fissati per esercizi non in scheda</h2>
            <p className="small muted">
              Restano salvati sul telefono (e nel backup): torneranno quando l’esercizio rientra in una scheda.
            </p>
          </div>
          {visibleOrphans.map((key) => (
            <OrphanCard key={key} exKey={key} pin={pins[key]} />
          ))}
        </section>
      )}
    </div>
  )
}

/* ───────────────────────── cards ───────────────────────── */

interface LibraryCardProps {
  exKey: string
  entry: LibraryEntry
  uses: readonly DayUse[] | undefined
  warmup: Warmup | undefined
  pin: MediaPin | undefined
}

const LibraryCard = memo(function LibraryCard({ exKey, entry, uses, warmup, pin }: LibraryCardProps) {
  const titleId = useId()
  const isTest = uses?.some((u) => u.test) ?? false
  return (
    <article className="card exl-card" aria-labelledby={titleId}>
      <div className="exl-card__head">
        <h3 id={titleId}>{entry.label}</h3>
        <code className="exl-key">{exKey}</code>
      </div>

      {(entry.measure || isTest || entry.hanging || entry.on_yellow) && (
        <div className="exl-badges">
          {isTest && <span className="badge badge--test">Test</span>}
          {entry.measure && <span className="badge exl-badge">Risultato: {measureText(entry.measure)}</span>}
          {entry.hanging && <span className="badge exl-badge exl-badge--hang">Sospensione</span>}
          {entry.on_yellow && (
            <span className="badge exl-badge exl-badge--yellow">
              🟡 Gomito giallo: {entry.on_yellow === 'skip' ? 'salta' : '½ serie'}
            </span>
          )}
        </div>
      )}

      <DaysLine uses={uses} />
      {warmup && warmup.items.length > 0 && <WarmupList warmup={warmup} />}
      {pin && <PinnedMedia pin={pin} label={entry.label} />}
      <MediaButtons exKey={exKey} fallbackQuery={entry.label} variant="card" />
    </article>
  )
})

function DaysLine({ uses }: { uses: readonly DayUse[] | undefined }) {
  if (!uses || uses.length === 0) {
    return <p className="exl-days small faint">Non previsto in questa scheda</p>
  }
  return (
    <p className="exl-days small">
      <span className="muted">In scheda:</span>
      {uses.map((u) => (
        <span key={u.date} className="exl-day num">
          {formatShortDate(u.date)}
          {u.count > 1 && (
            <>
              <span className="exl-day__count" aria-hidden="true">
                ×{u.count}
              </span>
              <span className="visually-hidden">, {u.count} volte</span>
            </>
          )}
        </span>
      ))}
    </p>
  )
}

function WarmupList({ warmup }: { warmup: Warmup }) {
  const n = warmup.items.length
  return (
    <details className="exl-warmup">
      <summary>
        <IconChevronRight className="exl-warmup__chev" />
        <span className="exl-warmup__title">Riscaldamento</span>
        <span className="exl-warmup__n small muted">{countLabel(n)}</span>
      </summary>
      <div className="exl-warmup__body">
        {warmup.title && <p className="small muted">{warmup.title}</p>}
        <ol className="exl-warmup__list">
          {warmup.items.map((item, i) => (
            <li key={i}>
              <div className="exl-warmup__row">
                <span className="exl-warmup__name">{item.name}</span>
                {item.dose && <span className="exl-warmup__dose num">{item.dose}</span>}
              </div>
              {item.note && <p className="small muted">{item.note}</p>}
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}

function PinnedMedia({ pin, label }: { pin: MediaPin; label: string }) {
  const media = useMemo(() => parseMediaUrl(pin.url), [pin.url])
  const caption = media.type === 'youtube' ? 'Video fissato' : media.type === 'image' ? 'Immagine fissata' : 'Media fissato'
  return (
    <div className="exl-media">
      <p className="exl-media__caption tiny">
        <IconPin /> {caption}
      </p>
      <MediaPreview media={media} title={label} rawUrl={pin.url} />
    </div>
  )
}

const OrphanCard = memo(function OrphanCard({ exKey, pin }: { exKey: string; pin: MediaPin }) {
  const titleId = useId()
  const query = keyToQuery(exKey)
  return (
    <article className="card exl-card exl-card--orphan" aria-labelledby={titleId}>
      <div className="exl-card__head">
        <h3 id={titleId} className="exl-key exl-key--title">
          {exKey}
        </h3>
      </div>
      <PinnedMedia pin={pin} label={query} />
      <MediaButtons exKey={exKey} fallbackQuery={query} variant="card" />
    </article>
  )
})
