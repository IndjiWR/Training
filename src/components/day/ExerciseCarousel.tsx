import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Plan } from '../../plan/schema'
import type { EffectiveExercise } from '../../lib/elbow'
import type { SessionLog } from '../../state/types'
import { ExerciseCard } from '../exercise/ExerciseCard'
import { IconChevronLeft, IconChevronRight, IconHome, IconList, IconStop } from '../icons'
import { toast } from '../../state/ui'
import { Sheet } from '../ui'
import { doneSets, initialSlide, isComplete, nextIncompletePos, plannedSets } from './dayUtils'
import { HiddenList } from './HiddenList'
import './day.css'

export interface ExerciseCarouselProps {
  date: string
  plan: Plan
  session: SessionLog | undefined
  /** The day after the elbow transform. */
  effs: readonly EffectiveExercise[]
  /** Elbow check pending: cards visible but inert. */
  locked: boolean
  /** Exercise index left out (the check-gomito while its gate is shown). */
  excludeIndex: number | null
  /** A session is running: the last slide offers "Termina sessione". */
  canFinish: boolean
  onFinish: () => void
}

interface Slide {
  eff: EffectiveExercise
  home: boolean
}

type SegmentState = 'done' | 'started' | 'todo'

/** After the last set, the ✓ and the rest timer show for this long before the next exercise slides in. */
const ADVANCE_DELAY_MS = 1200
/** A swipe has settled this long after the last scroll event (fallback where `scrollend` is missing). */
const SETTLE_MS = 120
const SLIDE_KEY = 'training:oggi:slide:'

function readSlide(date: string): number | null {
  try {
    const raw = sessionStorage.getItem(SLIDE_KEY + date)
    const n = raw == null ? Number.NaN : Number(raw)
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

function writeSlide(date: string, index: number): void {
  try {
    sessionStorage.setItem(SLIDE_KEY + date, String(index))
  } catch {
    /* unavailable: the first incomplete exercise is shown next time */
  }
}

function scrollBehavior(): ScrollBehavior {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return reduce ? 'auto' : 'smooth'
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/** Slide whose centre is closest to the centre of the track. */
function nearestSlide(track: HTMLElement): number {
  const centre = track.scrollLeft + track.clientWidth / 2
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  Array.from(track.children).forEach((child, i) => {
    const el = child as HTMLElement
    const distance = Math.abs(el.offsetLeft + el.offsetWidth / 2 - centre)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/**
 * The day's exercises as horizontal slides, one exercise per screen: swipe or use the arrows,
 * tap the counter for the whole list. Opens on the remembered or first incomplete exercise and
 * moves on by itself when the exercise on screen gets its last set. The track takes the height of
 * the current slide, so the page scrolls normally. Mount with key={date}.
 */
export function ExerciseCarousel({
  date,
  plan,
  session,
  effs,
  locked,
  excludeIndex,
  canFinish,
  onFinish,
}: ExerciseCarouselProps) {
  const slides = useMemo<Slide[]>(() => {
    const visible = effs.filter((e) => !e.hidden && e.index !== excludeIndex)
    return [
      ...visible.filter((e) => !e.ex.home).map((eff) => ({ eff, home: false })),
      ...visible.filter((e) => e.ex.home).map((eff) => ({ eff, home: true })),
    ]
  }, [effs, excludeIndex])
  const hidden = useMemo(() => effs.filter((e) => e.hidden), [effs])
  const order = useMemo(() => slides.map((s) => s.eff.index), [slides])
  const orderKey = order.join(',')
  const complete = useMemo(() => new Map(effs.map((e) => [e.index, isComplete(e, session)])), [effs, session])

  const [chosen, setChosen] = useState<number | null>(() => initialSlide(order, complete, readSlide(date)))
  // When the exercise on screen disappears (elbow change), the one that takes its place is shown.
  const lastPos = useRef(0)
  const chosenPos = chosen != null ? order.indexOf(chosen) : -1
  const pos = chosenPos >= 0 ? chosenPos : Math.max(0, Math.min(lastPos.current, order.length - 1))
  const current = order.length > 0 ? order[pos] : null
  const count = slides.length
  useEffect(() => {
    lastPos.current = pos
  }, [pos])
  const firstHome = slides.findIndex((s) => s.home)

  const hasSlides = count > 0
  const navRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const touching = useRef(false)
  const pendingAdvance = useRef<number | undefined>(undefined)
  /** Focus was in the track when moving: it goes to the new card's title (the old card turns inert). */
  const refocus = useRef(false)
  const [listOpen, setListOpen] = useState(false)
  const closeList = useCallback(() => setListOpen(false), [])

  // Latest values for timers and listeners.
  const live = useRef({ order, complete, current, pos })
  live.current = { order, complete, current, pos }

  const alignTrack = useCallback((p: number, smooth: boolean) => {
    const track = trackRef.current
    const el = track?.children[p] as HTMLElement | undefined
    if (!track || !el) return
    const left = el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2
    track.scrollTo({ left, behavior: smooth ? scrollBehavior() : 'auto' })
  }, [])

  const go = useCallback(
    (p: number) => {
      const o = live.current.order
      if (p < 0 || p >= o.length) return
      window.clearTimeout(pendingAdvance.current)
      if (trackRef.current?.contains(document.activeElement)) refocus.current = true
      setChosen(o[p])
      alignTrack(p, true)
    },
    [alignTrack],
  )

  // Swipes: the slide is chosen once the scroll settles with the finger up.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let timer: number | undefined
    const settle = () => {
      window.clearTimeout(timer)
      if (touching.current) return
      const o = live.current.order
      const p = nearestSlide(track)
      if (p >= 0 && p < o.length) setChosen((prev) => (prev === o[p] ? prev : o[p]))
    }
    const onScroll = () => {
      // A horizontal swipe is under way: no auto-advance on top of it.
      if (touching.current) window.clearTimeout(pendingAdvance.current)
      window.clearTimeout(timer)
      timer = window.setTimeout(settle, SETTLE_MS)
    }
    const onTouchStart = () => {
      touching.current = true
    }
    const onTouchEnd = () => {
      touching.current = false
      window.clearTimeout(timer)
      timer = window.setTimeout(settle, SETTLE_MS)
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    track.addEventListener('scrollend', settle)
    track.addEventListener('touchstart', onTouchStart, { passive: true })
    track.addEventListener('touchend', onTouchEnd, { passive: true })
    track.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.clearTimeout(timer)
      track.removeEventListener('scroll', onScroll)
      track.removeEventListener('scrollend', settle)
      track.removeEventListener('touchstart', onTouchStart)
      track.removeEventListener('touchend', onTouchEnd)
      track.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [hasSlides])

  // On open and when slides come or go (elbow change): keep the exercise shown in state (it may
  // have fallen back to another one) and put it in place, no animation.
  useLayoutEffect(() => {
    setChosen(live.current.current)
    alignTrack(live.current.pos, false)
  }, [orderKey, alignTrack])

  // Rotation / resize: keep the current slide aligned.
  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    let width = track.clientWidth
    const ro = new ResizeObserver(() => {
      if (track.clientWidth === width) return
      width = track.clientWidth
      alignTrack(live.current.pos, false)
    })
    ro.observe(track)
    return () => ro.disconnect()
  }, [alignTrack, hasSlides])

  // The track is as tall as the current slide: no gap under short exercises, no inner scrolling.
  useLayoutEffect(() => {
    const track = trackRef.current
    const el = track?.children[pos] as HTMLElement | undefined
    if (!track || !el) return
    const apply = () => {
      // Unrounded height: offsetHeight would clip a fraction of the bottom button.
      track.style.height = `${el.getBoundingClientRect().height / remPx()}rem`
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pos, orderKey])

  // Remember the slide; after a change, bring its top back into view if it is hidden under the
  // navigator while the carousel is being looked at; keep keyboard focus in the carousel.
  const firstRun = useRef(true)
  useEffect(() => {
    if (current != null) writeSlide(date, current)
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const track = trackRef.current
    if (!track) return
    const nav = navRef.current
    // Where the navigator sits once stuck (just under the status bar).
    const stuck = nav ? (parseFloat(getComputedStyle(nav).top) || 0) + nav.offsetHeight : 0
    const { top, bottom } = track.getBoundingClientRect()
    if (top < stuck && bottom > stuck) {
      window.scrollBy({ top: top - stuck - remPx() * 0.5, behavior: scrollBehavior() })
    }
    if (refocus.current) {
      refocus.current = false
      track.children[live.current.pos]?.querySelector<HTMLElement>('.ex-head__name')?.focus({ preventScroll: true })
    }
  }, [current, date])

  // The exercise on screen just got its last set: move on to the next incomplete one.
  const before = useRef<{ index: number | null; done: boolean } | null>(null)
  useEffect(() => {
    const done = current != null && complete.get(current) === true
    const prev = before.current
    before.current = { index: current, done }
    if (current == null || !done || !prev || prev.index !== current || prev.done) return
    const from = current
    window.clearTimeout(pendingAdvance.current)
    pendingAdvance.current = window.setTimeout(() => {
      const { order: o, complete: c, current: now } = live.current
      // Not if the user moved on or undid the set (a swipe under way cancels this timer).
      if (now !== from || !c.get(from)) return
      const next = nextIncompletePos(o, c, o.indexOf(from))
      if (next >= 0) go(next)
    }, ADVANCE_DELAY_MS)
  }, [current, complete, go])

  useEffect(() => () => window.clearTimeout(pendingAdvance.current), [])

  // Cards off screen are inert, so only a running timer (e.g. the warm-up countdown) can finish
  // one: say so, since its own messages are not on screen.
  const doneBefore = useRef<Map<number, number> | null>(null)
  useEffect(() => {
    const counts = new Map(slides.map((s) => [s.eff.index, doneSets(session, s.eff.index)]))
    const prev = doneBefore.current
    doneBefore.current = counts
    if (!prev) return
    for (const s of slides) {
      const i = s.eff.index
      // Slides that just appeared (e.g. the elbow check once settled) are not news.
      if (i === live.current.current || !prev.has(i)) continue
      if ((counts.get(i) ?? 0) > (prev.get(i) ?? 0) && complete.get(i)) {
        toast(`${s.eff.ex.name}: fatto ✓`, { tone: 'success' })
      }
    }
  }, [slides, session, complete])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (listOpen || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(pos - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(pos + 1)
    }
  }

  const segment = (e: EffectiveExercise): SegmentState =>
    complete.get(e.index) ? 'done' : doneSets(session, e.index) > 0 ? 'started' : 'todo'

  if (count === 0) return hidden.length > 0 ? <HiddenList hidden={hidden} /> : null
  const shown = slides[pos]

  return (
    <section
      id="dy-carousel"
      className="dy-carousel"
      aria-roledescription="carosello"
      aria-label="Esercizi del giorno"
      onKeyDown={onKeyDown}
    >
      <div className="dy-nav" ref={navRef}>
        <button
          type="button"
          className="btn btn--ghost btn--icon dy-nav__arrow"
          aria-label="Esercizio precedente"
          disabled={pos <= 0}
          onClick={() => go(pos - 1)}
        >
          <IconChevronLeft />
        </button>
        <button type="button" className="dy-nav__center" aria-haspopup="dialog" onClick={() => setListOpen(true)}>
          <span className="dy-nav__top">
            <span className="dy-nav__count num">
              {pos + 1}
              <span className="dy-nav__of">/{count}</span>
            </span>
            <span className="dy-nav__name">{shown.eff.ex.name}</span>
            <IconList className="dy-nav__list" aria-hidden="true" />
          </span>
          <span className="dy-nav__bar" aria-hidden="true">
            {slides.map((s, i) => (
              <span
                key={s.eff.index}
                className="dy-nav__seg"
                data-state={segment(s.eff)}
                data-current={i === pos || undefined}
                data-home={(i === firstHome && i > 0) || undefined}
              />
            ))}
          </span>
          <span className="visually-hidden">: mostra tutti gli esercizi</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon dy-nav__arrow"
          aria-label="Esercizio successivo"
          disabled={pos >= count - 1}
          onClick={() => go(pos + 1)}
        >
          <IconChevronRight />
        </button>
      </div>

      <div className="dy-track" ref={trackRef}>
        {slides.map((s, i) => {
          const next = slides[i + 1]
          return (
            <div
              key={s.eff.index}
              className="dy-slide"
              role="group"
              aria-roledescription="esercizio"
              aria-label={`${i + 1} di ${count}`}
              inert={i !== pos}
            >
              <ExerciseCard date={date} plan={plan} eff={s.eff} session={session} locked={locked} home={s.home} />
              <div className="dy-slide__nav">
                {i > 0 && (
                  <button
                    type="button"
                    className="btn btn--outline btn--icon dy-slide__prev"
                    aria-label="Esercizio precedente"
                    onClick={() => go(i - 1)}
                  >
                    <IconChevronLeft />
                  </button>
                )}
                {next ? (
                  <button
                    type="button"
                    className={`btn btn--block dy-slide__next ${complete.get(s.eff.index) ? 'btn--primary' : 'btn--outline'}`}
                    onClick={() => go(i + 1)}
                  >
                    <span className="dy-slide__next-text">
                      <span className="dy-slide__next-label">
                        {next.home && !s.home ? (
                          <>
                            <IconHome aria-hidden="true" /> Avanti · a casa
                          </>
                        ) : (
                          'Avanti'
                        )}
                      </span>
                      <span className="dy-slide__next-name">{next.eff.ex.name}</span>
                    </span>
                    <IconChevronRight />
                  </button>
                ) : canFinish ? (
                  <button type="button" className="btn btn--primary btn--block dy-slide__finish" onClick={onFinish}>
                    <IconStop />
                    Termina sessione
                  </button>
                ) : (
                  <p className="small muted dy-slide__end">Ultimo esercizio del giorno</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="visually-hidden" aria-live="polite">
        Esercizio {pos + 1} di {count}: {shown.eff.ex.name}
      </p>

      {hidden.length > 0 && <HiddenList hidden={hidden} />}

      {listOpen && (
        <JumpList
          slides={slides}
          pos={pos}
          firstHome={firstHome}
          session={session}
          segment={segment}
          onPick={(i) => {
            closeList()
            go(i)
          }}
          onClose={closeList}
        />
      )}
    </section>
  )
}

/* ───────────────────────── list of the day ───────────────────────── */

interface JumpListProps {
  slides: readonly Slide[]
  pos: number
  firstHome: number
  session: SessionLog | undefined
  segment: (e: EffectiveExercise) => SegmentState
  onPick: (pos: number) => void
  onClose: () => void
}

/** Every exercise of the day with its status: tap one to jump to it. */
function JumpList({ slides, pos, firstHome, session, segment, onPick, onClose }: JumpListProps) {
  const groups: Array<{ title: string | null; from: number; items: readonly Slide[] }> =
    firstHome > 0
      ? [
          { title: null, from: 0, items: slides.slice(0, firstHome) },
          { title: 'A casa', from: firstHome, items: slides.slice(firstHome) },
        ]
      : [{ title: firstHome === 0 ? 'A casa' : null, from: 0, items: slides }]

  return (
    <Sheet open title="Esercizi di oggi" onClose={onClose}>
      {groups.map((g) => (
        <div key={g.from} className="dy-jump-group">
          {g.title && (
            <h3 className="dy-section">
              <IconHome aria-hidden="true" />
              {g.title}
            </h3>
          )}
          <ol className="dy-jump" start={g.from + 1}>
            {g.items.map((s, k) => {
              const i = g.from + k
              const state = segment(s.eff)
              const done = doneSets(session, s.eff.index)
              const planned = plannedSets(s.eff)
              const status = state === 'done' ? '✓ fatto' : state === 'started' ? `${done}/${planned}` : null
              return (
                <li key={s.eff.index}>
                  <button
                    type="button"
                    className="dy-jump__item"
                    aria-current={i === pos ? 'step' : undefined}
                    onClick={() => onPick(i)}
                  >
                    <span className="dy-jump__pos num" data-state={state} aria-hidden="true">
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    <span className="dy-jump__text">
                      <span className="dy-jump__name">{s.eff.ex.name}</span>
                      {s.eff.ex.dose && <span className="dy-jump__meta">{s.eff.ex.dose}</span>}
                    </span>
                    {status && (
                      <span className="dy-jump__status num" data-state={state}>
                        {status}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </Sheet>
  )
}
