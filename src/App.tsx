import { useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
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
import { ExercisesScreen } from './screens/ExercisesScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { TodayScreen } from './screens/TodayScreen'
import { usePlanAutoSync } from './state/planSync'
import { getState, useAppData } from './state/store'

const SCREENS: Record<Route, ComponentType> = {
  oggi: TodayScreen,
  esercizi: ExercisesScreen,
  riepilogo: SummaryScreen,
  impostazioni: SettingsScreen,
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
          <Screen />
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
