import { useAppData } from '../../state/store'
import { useOnline } from './online'

/** Slim reassuring status line shown at the top of every page while offline. */
export function OfflineIndicator() {
  const online = useOnline()
  const hasPlan = useAppData((s) => s.plan !== null)
  if (online) return null
  return (
    <p className="sh-offline" role="status">
      <span className="sh-offline__pill">
        <span className="sh-offline__dot" aria-hidden="true" />
        Offline
      </span>
      <span className="visually-hidden">: </span>
      <span className="sh-offline__text">
        {hasPlan ? 'funziona tutto, la scheda è salvata' : 'la scheda si scarica quando torna la rete'}
      </span>
    </p>
  )
}
