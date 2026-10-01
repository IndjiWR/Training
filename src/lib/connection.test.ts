import { describe, expect, it } from 'vitest'
import codeGs from '../../apps-script/Code.gs?raw'
import fixture from '../../scheda-corrente.json'
import {
  buildConnectionLink,
  DEFAULT_FOLDER_ID,
  extractFolderId,
  generateToken,
  parseConnection,
  scriptWithSetup,
} from './connection'

const EXEC = 'https://script.google.com/macros/s/AKfycbx_abc123/exec'
const TOKEN = 'Zq3-xY_9kLmN0pQrStUvWxYz'

describe('parseConnection', () => {
  it('reads the …/exec?token=… link', () => {
    expect(parseConnection(`${EXEC}?token=${TOKEN}`)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('finds the link inside a message and drops trailing punctuation', () => {
    const r = parseConnection(`Collegamento Training: ${EXEC}?token=${TOKEN}.\nNon condividerlo!`)
    expect(r).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('accepts URL and token on two lines', () => {
    expect(parseConnection(`${EXEC}\n${TOKEN}`)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('keeps other query parameters but never the token in the endpoint', () => {
    const r = parseConnection(`${EXEC}?v=2&token=${TOKEN}`)
    expect(r).toEqual({ ok: true, endpoint: `${EXEC}?v=2`, token: TOKEN })
  })

  it('explains what is missing', () => {
    expect(parseConnection('   ')).toMatchObject({ ok: false, error: expect.stringContaining('vuoti') })
    expect(parseConnection('ciao')).toMatchObject({ ok: false, error: expect.stringContaining('https://') })
    expect(parseConnection(EXEC)).toMatchObject({ ok: false, error: expect.stringContaining('token') })
  })

  it('rejects the /dev test URL and non-https links', () => {
    const dev = parseConnection(`https://script.google.com/macros/s/X/dev?token=${TOKEN}`)
    expect(dev).toMatchObject({ ok: false, error: expect.stringContaining('/exec') })
    expect(parseConnection(`http://example.com/exec?token=${TOKEN}`)).toMatchObject({ ok: false })
  })

  it('round-trips with buildConnectionLink', () => {
    const link = buildConnectionLink(EXEC, TOKEN)
    expect(link).toBe(`${EXEC}?token=${TOKEN}`)
    expect(parseConnection(link)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })
})

describe('extractFolderId', () => {
  it('reads ids from links and bare ids', () => {
    expect(extractFolderId(DEFAULT_FOLDER_ID)).toBe(DEFAULT_FOLDER_ID)
    expect(extractFolderId(`https://drive.google.com/drive/folders/${DEFAULT_FOLDER_ID}?usp=sharing`)).toBe(
      DEFAULT_FOLDER_ID,
    )
    expect(extractFolderId(`https://drive.google.com/drive/u/0/folders/${DEFAULT_FOLDER_ID}`)).toBe(DEFAULT_FOLDER_ID)
    expect(extractFolderId(`https://drive.google.com/open?id=${DEFAULT_FOLDER_ID}`)).toBe(DEFAULT_FOLDER_ID)
  })

  it('returns null for anything else', () => {
    expect(extractFolderId('')).toBeNull()
    expect(extractFolderId('cartella allenamento')).toBeNull()
    expect(extractFolderId('https://drive.google.com/drive/my-drive')).toBeNull()
  })
})

describe('generateToken', () => {
  it('is long, URL-safe and different every time', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
})

/* ───────── the generated Apps Script, run against fake Google services ───────── */

interface FakeFile {
  name: string
  text: string
  trashed?: boolean
  updated?: number
}

function runScript(code: string, files: FakeFile[], initialProps: Record<string, string> = {}) {
  const props: Record<string, string> = { ...initialProps }
  const logs: string[] = []
  const output = (text: string) => ({ text, setMimeType: () => ({ text }) })
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperties: (p: Record<string, string>) => Object.assign(props, p),
      }),
    },
    DriveApp: {
      getFolderById: (id: string) => {
        if (id !== DEFAULT_FOLDER_ID) throw new Error('not found')
        return {
          getName: () => 'Schede',
          getFiles: () => {
            let i = 0
            return {
              hasNext: () => i < files.length,
              next: () => {
                const f = files[i++]
                return {
                  getName: () => f.name,
                  isTrashed: () => Boolean(f.trashed),
                  getLastUpdated: () => new Date(f.updated ?? 0),
                  getBlob: () => ({ getDataAsString: () => f.text }),
                }
              },
            }
          },
        }
      },
    },
    ContentService: { createTextOutput: output, MimeType: { JSON: 'json' } },
    Utilities: {
      // Equal inputs -> equal bytes is all safeEquals_ needs.
      computeDigest: (_alg: unknown, s: string) => Array.from(new TextEncoder().encode(s)),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
    },
    console: { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: () => {} },
  }
  const names = Object.keys(globals)
  const load = new Function(...names, `${code}\nreturn { doGet, setup, checkSetup };`)
  const api = load(...Object.values(globals)) as {
    doGet: (e: unknown) => { text: string }
    setup: () => void
    checkSetup: () => boolean
  }
  return { api, props, logs }
}

const PLAN_TEXT = JSON.stringify(fixture)
const FILES: FakeFile[] = [
  { name: 'scheda-2026-09-24.json', text: '{"old":true}' },
  { name: 'scheda-2026-10-01.json', text: PLAN_TEXT },
  { name: 'note.txt', text: 'x' },
]

describe('Apps Script setup()', () => {
  it('stores the folder and token prepared by the app, then serves the newest plan as-is', () => {
    const { api, props, logs } = runScript(scriptWithSetup(codeGs, DEFAULT_FOLDER_ID, TOKEN), FILES)
    api.setup()
    expect(props).toEqual({ FOLDER_ID: DEFAULT_FOLDER_ID, TOKEN })
    expect(logs.join('\n')).toContain('scheda-2026-10-01.json')
    expect(logs.join('\n')).toContain('Pronto')
    expect(logs.join('\n')).not.toContain(TOKEN)

    expect(api.doGet({ parameter: { token: TOKEN } }).text).toBe(PLAN_TEXT)
    expect(JSON.parse(api.doGet({ parameter: { token: 'sbagliato' } }).text)).toEqual({ error: 'unauthorized' })
    expect(JSON.parse(api.doGet({ parameter: {} }).text)).toEqual({ error: 'unauthorized' })
  })

  it('does nothing without the SETUP constants (plain Code.gs)', () => {
    const { api, props, logs } = runScript(codeGs, FILES, { TOKEN: 'esistente' })
    api.setup()
    expect(props).toEqual({ TOKEN: 'esistente' })
    expect(logs.join('\n')).toContain('Mancano SETUP_FOLDER_ID')
  })

  it('does not report ready when the folder is wrong', () => {
    const { api, logs } = runScript(scriptWithSetup(codeGs, 'cartellaSbagliata123', TOKEN), FILES)
    api.setup()
    expect(logs.join('\n')).toContain('non trovata')
    expect(logs.join('\n')).not.toContain('Pronto')
  })
})
