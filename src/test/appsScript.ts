import codeGs from '../../apps-script/Code.gs?raw'
import { DEFAULT_FOLDER_ID, scriptWithSetup } from '../lib/connection'

/**
 * Test helper: runs the real apps-script/Code.gs against in-memory fakes of the Google services it
 * uses (Drive folder and files, Script Properties, lock, ContentService, Utilities).
 */

export const DATA_FILE = 'training-dati.json'

export interface FakeFile {
  name: string
  text: string
  trashed?: boolean
  updated?: number
}

export interface ScriptOptions {
  initialProps?: Record<string, string>
  /** The script lock is held by another execution. */
  busy?: boolean
  /** Writing to Drive throws a permission error (script authorized read-only). */
  readOnly?: boolean
}

export interface ScriptApi {
  doGet: (e: unknown) => { text: string }
  doPost: (e: unknown) => { text: string }
  setup: () => void
  checkSetup: () => boolean
}

/** `options` stays live: tests may flip `busy` / `readOnly` between calls. */
export function runScript(code: string, files: FakeFile[], options: ScriptOptions = {}) {
  const props: Record<string, string> = { ...(options.initialProps ?? {}) }
  const logs: string[] = []
  let clock = 1_000
  let uuids = 0
  const output = (text: string) => ({ text, setMimeType: () => ({ text }) })
  const denied = () => {
    throw new Error('You do not have permission to call DriveApp.File.setContent. Required permissions: drive')
  }
  const fileApi = (f: FakeFile) => ({
    getName: () => f.name,
    isTrashed: () => Boolean(f.trashed),
    getLastUpdated: () => new Date(f.updated ?? 0),
    getBlob: () => ({ getDataAsString: () => f.text }),
    setContent: (text: string) => {
      if (options.readOnly) denied()
      f.text = text
      f.updated = ++clock
    },
  })
  const iterate = (list: FakeFile[]) => {
    let i = 0
    return { hasNext: () => i < list.length, next: () => fileApi(list[i++]) }
  }
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => {
          props[k] = String(v)
        },
        setProperties: (p: Record<string, string>) => Object.assign(props, p),
      }),
    },
    DriveApp: {
      getFolderById: (id: string) => {
        if (id !== DEFAULT_FOLDER_ID) throw new Error('not found')
        return {
          getName: () => 'Schede',
          getFiles: () => iterate(files),
          getFilesByName: (name: string) => iterate(files.filter((f) => f.name === name)),
          createFile: (name: string, text: string) => {
            if (options.readOnly) denied()
            const f: FakeFile = { name, text, updated: ++clock }
            files.push(f)
            return fileApi(f)
          },
        }
      },
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !options.busy, releaseLock: () => {} }),
    },
    ContentService: { createTextOutput: output, MimeType: { JSON: 'json' } },
    Utilities: {
      // Equal inputs -> equal bytes is all safeEquals_ needs.
      computeDigest: (_alg: unknown, s: string) => Array.from(new TextEncoder().encode(s)),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => `epoch-${++uuids}`,
    },
    console: { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: () => {} },
  }
  const load = new Function(...Object.keys(globals), `${code}\nreturn { doGet, doPost, setup, checkSetup };`)
  const api = load(...Object.values(globals)) as ScriptApi
  return { api, props, logs, files, options }
}

export type Script = ReturnType<typeof runScript>

/** The script as copied by the guided setup, with `setup()` already run (data file created). */
export function setUpScript(token: string, files: FakeFile[], options: ScriptOptions = {}): Script {
  const script = runScript(scriptWithSetup(codeGs, DEFAULT_FOLDER_ID, token), files, options)
  script.api.setup()
  return script
}

/** Parsed content of the data file (the most recently updated copy). */
export function storedData(files: FakeFile[]) {
  const copies = files.filter((f) => f.name === DATA_FILE && !f.trashed)
  copies.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  if (!copies.length) throw new Error(`${DATA_FILE} missing`)
  return JSON.parse(copies[0].text)
}

/** One POST to the web app, as the browser would send it. */
export function post(script: Script, body: unknown, token: string) {
  return JSON.parse(script.api.doPost({ parameter: { token }, postData: { contents: JSON.stringify(body) } }).text)
}
