import { parsePlan, type Plan } from '../plan/schema'

export type FetchPlanErrorKind = 'config' | 'offline' | 'network' | 'http' | 'unauthorized' | 'invalid'

export type FetchPlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; kind: FetchPlanErrorKind; error: string }

/** The request gives up (as a network error) after this many ms: Apps Script cold starts take a few s. */
export const FETCH_TIMEOUT_MS = 45_000

/** A plan file is a few tens of kB: anything this large is certainly the wrong file. */
export const MAX_PLAN_FILE_BYTES = 5 * 1024 * 1024

/**
 * The only RequestInit ever used: no headers and no body keep it a CORS "simple request"
 * (Apps Script cannot answer a preflight); cookies are never sent.
 */
const REQUEST_INIT: RequestInit = { method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit' }

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/i
const DEPLOY_HINT = 'Nel deploy imposta «Chi può accedere: Chiunque» (Anyone) e usa l’URL che termina con /exec.'

/** The script answered, but with a Google page (no CORS headers) instead of its JSON. */
export const BLOCKED_HINT =
  'Apri il collegamento nel browser del computer per vedere il motivo. Di solito, dopo un aggiornamento dello script, manca l’autorizzazione: nell’editor esegui «setup» e consenti l’accesso a Drive. Oppure il deployment non è aperto a «Chiunque», o l’URL è di un deployment archiviato.'

/** How long the check "does the script answer at all?" may take. */
const PROBE_TIMEOUT_MS = 15_000

function fail(kind: FetchPlanErrorKind, error: string): FetchPlanResult {
  return { ok: false, kind, error }
}

/** Strips a UTF-8 byte order mark (files saved by some Windows editors start with it). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Builds the GET URL: endpoint + ?token=<token> (or &token= if the endpoint already has a
 * query). Throws on an invalid/non-https endpoint (http://localhost allowed for testing).
 */
export function buildPlanUrl(endpoint: string, token: string): string {
  const raw = endpoint.trim()
  if (!raw) throw new Error('Manca l’URL dello script.')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('L’URL dello script non è valido: copia l’URL completo del deploy (https://script.google.com/…/exec).')
  }
  const local = url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)
  if (url.protocol !== 'https:' && !local) {
    throw new Error('L’URL dello script deve iniziare con https://')
  }
  if (url.hostname === 'script.google.com' && /\/dev\/?$/.test(url.pathname)) {
    throw new Error('Stai usando l’URL di test (/dev): copia quello del deploy che termina con /exec.')
  }
  // Keep the existing query verbatim, replacing any previous token parameter.
  const params = queryWithoutToken(url.search)
  params.push(`token=${encodeURIComponent(token.trim())}`)
  url.search = `?${params.join('&')}`
  url.hash = ''
  return url.toString()
}

const isTokenParam = (part: string): boolean => part === 'token' || part.startsWith('token=')

/** The non-empty parts of a query string (with or without '?'), verbatim, minus any token parameter. */
function queryWithoutToken(search: string): string[] {
  return search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '' && !isTokenParam(part))
}

/**
 * The endpoint (trimmed) without any `token` query parameter, e.g. a URL copied from the address
 * bar after opening …/exec?token=…: the secret must never be stored in settings.endpoint.
 * Input without a token parameter, or not a URL at all, is returned trimmed and otherwise unchanged.
 */
export function stripTokenParam(endpoint: string): string {
  const raw = endpoint.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  if (!url.search.replace(/^\?/, '').split('&').some(isTokenParam)) return raw
  const params = queryWithoutToken(url.search)
  url.search = params.length > 0 ? `?${params.join('&')}` : ''
  return url.toString()
}

/** Italian message for a {"error": "..."} body returned by apps-script/Code.gs. */
function serverError(body: { error: unknown; file?: unknown; message?: unknown }): FetchPlanResult {
  const code = String(body.error)
  switch (code) {
    case 'unauthorized':
      return fail(
        'unauthorized',
        'Token non valido: deve coincidere con la proprietà TOKEN dello script (Impostazioni progetto → Proprietà script).',
      )
    case 'not_found':
      return fail(
        'http',
        'Nessuna scheda nella cartella Drive: il file deve chiamarsi scheda-AAAA-MM-GG.json (es. scheda-2026-10-04.json).',
      )
    case 'not_configured':
      return fail('http', 'Lo script non è configurato: manca la proprietà FOLDER_ID (Impostazioni progetto → Proprietà script).')
    case 'folder_unavailable':
      return fail(
        'http',
        'Lo script non riesce ad aprire la cartella Drive: controlla la proprietà FOLDER_ID e che la cartella sia tua.',
      )
    case 'invalid_json': {
      const file = typeof body.file === 'string' && body.file ? `«${body.file}»` : 'più recente'
      return fail('invalid', `Il file ${file} su Drive non è un JSON valido: correggilo o sostituiscilo.`)
    }
    case 'internal': {
      const detail = typeof body.message === 'string' && body.message ? `: ${body.message}` : ''
      return fail('http', `Errore interno dello script${detail}`)
    }
    default:
      return fail('http', `Il server ha risposto con un errore: ${code}`)
  }
}

function httpError(status: number): FetchPlanResult {
  if (status === 404) {
    return fail('http', 'Script non trovato (HTTP 404): controlla l’URL e che il deploy esista ancora.')
  }
  if (status === 401 || status === 403) {
    return fail('http', `Accesso negato (HTTP ${status}). ${DEPLOY_HINT}`)
  }
  if (status === 429) {
    return fail('http', 'Troppe richieste (HTTP 429): riprova tra qualche minuto.')
  }
  if (status >= 500) {
    return fail('http', `Il server di Google non risponde correttamente (HTTP ${status}): riprova più tardi.`)
  }
  return fail('http', `Risposta inattesa dal server (HTTP ${status}).`)
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Resolves with null when `ms` elapse first (the request itself is just ignored). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * After a request failed like a network error: did the server answer at all? A Google page
 * (login, authorization needed, deployment not found) has no CORS headers, so the browser hides
 * it; a "no-cors" request still resolves (with an opaque response) whenever there is an answer.
 */
export async function answersWithoutCors(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await withTimeout(fetchImpl(url, { ...REQUEST_INIT, mode: 'no-cors' }), PROBE_TIMEOUT_MS)) != null
  } catch {
    return false
  }
}

/**
 * After another request to the script failed like a network error: 'json' the deployment answers
 * a plain GET normally (so it is that other function that fails, e.g. a script without doPost),
 * 'page' it answers with a Google page, 'none' no answer at all. The GET carries no token.
 */
export async function probeScript(endpoint: string, fetchImpl: typeof fetch = fetch): Promise<'json' | 'page' | 'none'> {
  let url: string
  try {
    url = new URL(endpoint.trim()).toString()
  } catch {
    return 'none'
  }
  try {
    const res = await withTimeout(fetchImpl(url, { ...REQUEST_INIT }), PROBE_TIMEOUT_MS)
    if (res) {
      try {
        JSON.parse(stripBom(await res.text()))
        return 'json'
      } catch {
        return 'page'
      }
    }
  } catch {
    /* hidden by CORS, or no connection: tell them apart below */
  }
  return (await answersWithoutCors(url, fetchImpl)) ? 'page' : 'none'
}

/**
 * Plain GET (no custom headers, no body, no credentials: Apps Script cannot answer a CORS
 * preflight; redirects are followed), then JSON parse, {"error":"unauthorized"} detection and
 * zod validation via parsePlan. Never throws: every failure becomes { ok:false, kind, error }
 * with a clear Italian message. Missing endpoint/token -> kind 'config'.
 */
export async function fetchPlan(
  endpoint: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchPlanResult> {
  const ep = endpoint.trim()
  const tk = token.trim()
  if (!ep && !tk) return fail('config', 'Inserisci URL dello script e token in Impostazioni.')
  if (!ep) return fail('config', 'Manca l’URL dello script: inseriscilo in Impostazioni.')
  if (!tk) return fail('config', 'Manca il token: inseriscilo in Impostazioni.')

  let url: string
  try {
    url = buildPlanUrl(ep, tk)
  } catch (e) {
    return fail('config', e instanceof Error ? e.message : 'URL dello script non valido.')
  }

  if (isOffline()) return fail('offline', 'Sei offline: impossibile scaricare la scheda adesso.')

  let text: string
  let status: number
  try {
    const res = await withTimeout(fetchImpl(url, { ...REQUEST_INIT }), FETCH_TIMEOUT_MS)
    if (!res) {
      return fail('network', 'Il server non ha risposto in tempo: controlla la connessione e riprova.')
    }
    status = res.status
    if (!res.ok) return httpError(status)
    text = await res.text()
  } catch {
    if (isOffline()) return fail('offline', 'Sei offline: impossibile scaricare la scheda adesso.')
    if (await answersWithoutCors(url, fetchImpl)) {
      return fail('http', `Lo script risponde con una pagina di Google invece che con la scheda. ${BLOCKED_HINT}`)
    }
    return fail('network', `Impossibile contattare lo script: controlla la connessione e l’URL. ${DEPLOY_HINT}`)
  }

  const body = stripBom(text).trim()
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    if (/doGet/.test(body)) {
      return fail(
        'invalid',
        'Lo script non contiene la funzione doGet: incolla Code.gs e pubblica una nuova versione del deploy.',
      )
    }
    if (body.startsWith('<')) {
      return fail(
        'invalid',
        `Lo script ha risposto con una pagina web (di solito l’accesso Google) invece che con la scheda. ${DEPLOY_HINT}`,
      )
    }
    return fail('invalid', `La risposta dello script non è JSON (HTTP ${status}). ${DEPLOY_HINT}`)
  }

  if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json && !('days' in json)) {
    return serverError(json as { error: unknown })
  }

  const parsed = parsePlan(json)
  if (!parsed.ok) return fail('invalid', parsed.error)
  return { ok: true, plan: parsed.plan }
}

/**
 * True when `incoming` should replace `current`: no current plan, or incoming.generated_at is
 * strictly later (compare Date.parse; if either is unparsable compare strings), or same
 * generated_at but different id is NOT newer (returns false).
 */
export function isNewerPlan(incoming: Plan, current: Plan | null): boolean {
  if (!current) return true
  const a = Date.parse(incoming.generated_at)
  const b = Date.parse(current.generated_at)
  if (Number.isNaN(a) || Number.isNaN(b)) return incoming.generated_at > current.generated_at
  return a > b
}

/** Reads a user-picked .json File and validates it with parsePlan. */
export async function readPlanFile(file: File): Promise<{ ok: true; plan: Plan } | { ok: false; error: string }> {
  const name = file.name ? `«${file.name}»` : 'selezionato'
  if (file.size > MAX_PLAN_FILE_BYTES) {
    return { ok: false, error: `Il file ${name} è troppo grande per essere una scheda.` }
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: `Impossibile leggere il file ${name}.` }
  }
  let json: unknown
  try {
    json = JSON.parse(stripBom(text))
  } catch {
    return {
      ok: false,
      error: `Il file ${name} non è un JSON valido: scegli il file scheda-AAAA-MM-GG.json scaricato da Drive.`,
    }
  }
  const parsed = parsePlan(json)
  return parsed.ok ? { ok: true, plan: parsed.plan } : { ok: false, error: parsed.error }
}
