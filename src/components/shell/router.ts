import { useSyncExternalStore } from 'react'

/**
 * Tiny hash router: `#/oggi` (default, also for empty/unknown hashes), `#/esercizi`,
 * `#/riepilogo`, `#/impostazioni`. Anything after the first segment (`#/oggi/…`, `#/oggi?…`)
 * is ignored here, so screens may append their own state to the hash.
 */

export type Route = 'oggi' | 'esercizi' | 'riepilogo' | 'impostazioni'

export const ROUTES: readonly Route[] = ['oggi', 'esercizi', 'riepilogo', 'impostazioni']
export const DEFAULT_ROUTE: Route = 'oggi'

/** Page names (bottom nav labels and document.title). */
export const ROUTE_TITLES: Record<Route, string> = {
  oggi: 'Oggi',
  esercizi: 'Esercizi',
  riepilogo: 'Riepilogo',
  impostazioni: 'Impostazioni',
}

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value)
}

/** '#/riepilogo' -> 'riepilogo'; '', '#', '#/boh' -> 'oggi'. */
export function parseHash(hash: string): Route {
  const match = /^#?\/?([^/?#]*)/.exec(hash)
  const segment = decodeSegment(match?.[1] ?? '').toLowerCase()
  return isRoute(segment) ? segment : DEFAULT_ROUTE
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function routeHref(route: Route): string {
  return `#/${route}`
}

/** Navigates to `route` (no-op when already there). */
export function navigate(route: Route): void {
  const href = routeHref(route)
  if (window.location.hash !== href) window.location.hash = href
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getSnapshot(): Route {
  return parseHash(window.location.hash)
}

function getServerSnapshot(): Route {
  return DEFAULT_ROUTE
}

/** Current route, re-rendering on every hash change. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Smooth scroll to the top unless the user prefers reduced motion. */
export function scrollToTop(smooth = false): void {
  const reduce =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, left: 0, behavior: smooth && !reduce ? 'smooth' : 'auto' })
}
