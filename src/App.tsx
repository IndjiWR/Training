import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
import './components/shell/shell.css'
import { useWorkoutActive } from './components/day/useWorkoutActive'
import { BottomNav } from './components/shell/BottomNav'
import { ErrorBoundary } from './components/shell/ErrorBoundary'
import { OfflineIndicator } from './components/shell/OfflineIndicator'
import { ROUTE_TITLES, scrollToTop, useRoute, type Route } from './components/shell/router'
import { applyTheme } from './components/shell/theme'
import { ToastHost } from './components/shell/ToastHost'
import { UpdatePrompt } from './components/shell/UpdatePrompt'
import { RestTimerBar } from './components/timers/RestTimerBar'
import { useWakeLock } from './lib/wakeLock'
import { TodayScreen } from './screens/TodayScreen'
import { usePlanAutoSync } from './state/planSync'
import { getState, useAppData } from './state/store'

// Oggi is in the main bundle (it opens first, at the park); the other screens are separate chunks,
// precached by the service worker for offline use and warmed up once the app is idle.
const loadExercises = () => import('./screens/ExercisesScreen').then((m) => ({ default: m.ExercisesScreen }))
const loadSummary = () => import('./screens/SummaryScreen').then((m) => ({ default: m.SummaryScreen }))
const loadSettings = () => import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))

const SCREENS: Record<Route, ComponentType> = {
  oggi: TodayScreen,
  esercizi: lazy(loadExercises),
  riepilogo: lazy(loadSummary),
  impostazioni: lazy(loadSettings),
}

function preloadScreens(): void {
  void loadExercises().catch(() => {})
  void loadSummary().catch(() => {})
  void loadSettings().catch(() => {})
}

// Apply the saved theme before the first paint (index.html defaults to dark).
applyTheme(getState().settings.theme)

export function App() {
  const route = useRoute()
  const theme = useAppData((s) => s.settings.theme)
  const mainRef = useRef<HTMLElement>(null)
  const prevRoute = useRef(route)

  usePlanAutoSync()

  // Screen stays on for the whole workout, whatever the tab or the day shown (rest and
  // countdowns keep running off Oggi). Oggi claims the same shared lock for its badge.
  const inWorkout = useWorkoutActive()
  useWakeLock(inWorkout)

  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    document.title = `Training · ${ROUTE_TITLES[route]}`
  }, [route])

  // Warm up the other screens when the app is idle: the first tab switch is then instant.
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preloadScreens, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(preloadScreens, 1500)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (prevRoute.current === route) return
    prevRoute.current = route
    scrollToTop()
    // Move focus to the new page so screen readers do not stay on the old tab.
    mainRef.current?.focus({ preventScroll: true })
  }, [route])

  const Screen = SCREENS[route]

  return (
    <>
      <div className="sh-statusbar" aria-hidden="true" />
      <main className="sh-main" id="main" ref={mainRef} tabIndex={-1} aria-label={ROUTE_TITLES[route]}>
        <div className="sh-status">
          <OfflineIndicator />
          <UpdatePrompt />
        </div>
        <ErrorBoundary resetKey={route}>
          <Suspense fallback={<p className="muted small">Carico…</p>}>
            <Screen />
          </Suspense>
        </ErrorBoundary>
      </main>
      <ErrorBoundary resetKey="rest" silent>
        <RestTimerBar />
      </ErrorBoundary>
      <BottomNav route={route} />
      <ToastHost />
    </>
  )
}
