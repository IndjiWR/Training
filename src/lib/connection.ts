import { buildPlanUrl, stripTokenParam } from './sync'

/**
 * "Collegamento": the Apps Script /exec URL with its token (…/exec?token=…), the single string
 * that links a device to Google Drive. It is created once on a computer and pasted on the phone
 * (on iPhone an installed web app cannot be opened by a link, so pasting is the reliable way).
 */

/** Drive folder of the weekly plans. Not a secret: without access rights the id opens nothing. */
export const DEFAULT_FOLDER_ID = '1tAj1pJI5127hdcePT1p_hrbIQOgRh7TO'

export type ParsedConnection = { ok: true; endpoint: string; token: string } | { ok: false; error: string }

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»“”]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/
const TOKEN_WORD = /^[A-Za-z0-9_\-.~]{16,}$/

/**
 * Reads a collegamento from pasted text: the URL can be alone or inside a message. The token is
 * the URL's `token` parameter or, failing that, a separate long word in the same text (e.g. URL
 * and token pasted on two lines). Never throws.
 */
export function parseConnection(text: string): ParsedConnection {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Gli appunti sono vuoti: copia prima il collegamento.' }

  const urls = (raw.match(URL_IN_TEXT) ?? []).map((u) => u.replace(TRAILING_PUNCTUATION, ''))
  if (urls.length === 0) {
    return { ok: false, error: 'Nel testo incollato non c’è un indirizzo che inizia con https://' }
  }
  const withToken = urls.find((u) => tokenOf(u) !== null)
  const link = withToken ?? urls[0]
  const endpoint = stripTokenParam(link)

  let token = tokenOf(link)
  if (!token) {
    const words = raw.split(/\s+/).filter((w) => !/^https?:\/\//i.test(w) && TOKEN_WORD.test(w))
    token = words.length === 1 ? words[0] : null
  }
  if (!token) {
    return { ok: false, error: 'Manca il token: il collegamento deve finire con «?token=…».' }
  }

  try {
    buildPlanUrl(endpoint, token)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return { ok: true, endpoint, token }
}

function tokenOf(link: string): string | null {
  try {
    return new URL(link).searchParams.get('token')?.trim() || null
  } catch {
    return null
  }
}

/** The collegamento to copy to another device: endpoint + ?token= (throws on an invalid endpoint). */
export function buildConnectionLink(endpoint: string, token: string): string {
  return buildPlanUrl(endpoint, token)
}

const FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/

/** Folder id from a Drive folder link (…/folders/<id>, …?id=<id>) or a bare id; null otherwise. */
export function extractFolderId(input: string): string | null {
  const value = input.trim()
  if (FOLDER_ID.test(value)) return value
  const inPath = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(value)
  if (inPath) return inPath[1]
  try {
    const id = new URL(value).searchParams.get('id')
    return id && FOLDER_ID.test(id) ? id : null
  } catch {
    return null
  }
}

/** Random token: `bytes` random bytes as base64url (no characters to escape in a URL). */
export function generateToken(bytes = 32): string {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  let binary = ''
  for (const b of data) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Code.gs with the folder and token prepended as SETUP_* constants: running setup() once in the
 * Apps Script editor stores them in the Script Properties (where doGet reads them).
 */
export function scriptWithSetup(code: string, folderId: string, token: string): string {
  const header = [
    '// ── Configurazione preparata dall’app Training ──',
    '// 1) Salva (Ctrl+S / ⌘S)   2) scegli la funzione «setup» in alto e premi Esegui',
    '// 3) Esegui il deployment → Nuovo deployment → Applicazione web.',
    '// SETUP_TOKEN è un segreto: non condividere questo codice. Dopo il setup puoi cancellare',
    '// queste due righe: i valori restano salvati nelle Proprietà script.',
    `const SETUP_FOLDER_ID = ${JSON.stringify(folderId)};`,
    `const SETUP_TOKEN = ${JSON.stringify(token)};`,
    '',
    '',
  ].join('\n')
  return header + code
}
