import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from '../../state/ui'
import { useWorkoutActive } from '../day/useWorkoutActive'
import { IconRefresh } from '../icons'

const UPDATE_CHECK_MS = 60 * 60 * 1000
const RELOAD_TIMEOUT_MS = 15_000

let updateTimer: ReturnType<typeof setInterval> | null = null

/** Hourly check for a new service worker while online (registerType 'prompt': never auto-reloads). */
function scheduleUpdateChecks(registration: ServiceWorkerRegistration | undefined): void {
  if (!registration || updateTimer) return
  updateTimer = setInterval(() => {
    if (!navigator.onLine || registration.installing) return
    registration.update().catch(() => {
      /* offline or server unreachable: try again at the next tick */
    })
  }, UPDATE_CHECK_MS)
}

/**
 * Service worker lifecycle UI: "Pronta per l'uso offline" toast after the first install and a
 * persistent banner when a new version is waiting. The page reloads only when the user taps
 * "Aggiorna" (never in the middle of a workout by itself).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => scheduleUpdateChecks(registration),
    onRegisterError: (error: unknown) => {
      console.warn('Registrazione del service worker non riuscita', error)
    },
  })
  const [updating, setUpdating] = useState(false)
  const inWorkout = useWorkoutActive()

  // Safety net: if the reload does not happen, give the button back with a hint.
  useEffect(() => {
    if (!updating) return
    const timer = setTimeout(() => {
      setUpdating(false)
      toast("L'aggiornamento ci sta mettendo troppo: chiudi e riapri l'app per completarlo.", { tone: 'warn' })
    }, RELOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [updating])

  useEffect(() => {
    if (!offlineReady) return
    toast("Pronta per l'uso offline: al parco funziona anche senza rete.", { tone: 'success' })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  if (!needRefresh) return null

  const update = async () => {
    setUpdating(true)
    try {
      // The new service worker takes control and the page reloads by itself.
      await updateServiceWorker(true)
    } catch {
      setUpdating(false)
      toast('Aggiornamento non riuscito. Riprova più tardi.', { tone: 'error' })
    }
  }

  return (
    <section className="banner banner--info sh-update" aria-labelledby="sh-update-title">
      <div className="sh-update__text">
        <h2 id="sh-update-title" className="sh-update__title">
          Nuova versione dell&apos;app disponibile
        </h2>
        <p className="small muted">
          {inWorkout
            ? 'Allenamento in corso: i dati sono salvati, ma aggiornando si azzera il timer di recupero. Meglio a fine sessione.'
            : "L'app si ricarica in un attimo: i dati restano sul dispositivo."}
        </p>
      </div>
      <div className="sh-update__actions">
        <button type="button" className="btn btn--primary" onClick={update} disabled={updating}>
          <IconRefresh className={updating ? 'sh-spin' : undefined} />
          {updating ? 'Aggiorno…' : 'Aggiorna'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setNeedRefresh(false)} disabled={updating}>
          Più tardi
        </button>
      </div>
    </section>
  )
}
