import { Component, type ErrorInfo, type ReactNode } from 'react'
import { routeHref } from './router'

interface Props {
  /** Changing this value (e.g. the route) clears a previous error. */
  resetKey: string
  /** Render nothing on error (for global widgets such as the rest timer bar). */
  silent?: boolean
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps a crash inside one screen from taking down the navigation (and the user's workout). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Errore nella pagina', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  private retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.silent) return null
    return (
      <section className="card stack sh-crash" aria-labelledby="sh-crash-title">
        <h1 id="sh-crash-title">Questa pagina ha avuto un problema</h1>
        <p>
          I tuoi dati sono al sicuro su questo dispositivo. Prova a ricaricare la pagina; se il problema resta,
          esporta un backup da Impostazioni.
        </p>
        <pre className="sh-crash__detail tiny">{error.message || String(error)}</pre>
        <div className="stack-sm">
          <button type="button" className="btn btn--primary btn--big btn--block" onClick={this.retry}>
            Riprova
          </button>
          <button type="button" className="btn btn--outline btn--block" onClick={() => window.location.reload()}>
            Ricarica l&apos;app
          </button>
          {this.props.resetKey !== 'impostazioni' && (
            <a className="btn btn--ghost btn--block" href={routeHref('impostazioni')}>
              Vai a Impostazioni
            </a>
          )}
        </div>
      </section>
    )
  }
}
