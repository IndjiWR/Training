import { describe, expect, it } from 'vitest'
import codeGs from '../../apps-script/Code.gs?raw'
import fixture from '../../scheda-corrente.json'
import { DATA_FILE, post, runScript, setUpScript, storedData, type FakeFile } from '../test/appsScript'
import { DEFAULT_FOLDER_ID, scriptWithSetup } from './connection'

/* The real apps-script/Code.gs, run against fake Google services. */

const TOKEN = 'Zq3-xY_9kLmN0pQrStUvWxYz'
const DAY = '2026-10-01'
const PLAN_TEXT = JSON.stringify(fixture)
const plans = (): FakeFile[] => [
  { name: 'scheda-2026-09-24.json', text: '{"old":true}' },
  { name: 'scheda-2026-10-01.json', text: PLAN_TEXT },
  { name: 'note.txt', text: 'x' },
]

describe('Apps Script setup()', () => {
  it('stores the folder and token prepared by the app, then serves the newest plan as-is', () => {
    const { api, props, logs } = runScript(scriptWithSetup(codeGs, DEFAULT_FOLDER_ID, TOKEN), plans())
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
    const { api, props, logs } = runScript(codeGs, plans(), { initialProps: { TOKEN: 'esistente' } })
    api.setup()
    expect(props).toEqual({ TOKEN: 'esistente' })
    expect(logs.join('\n')).toContain('Mancano SETUP_FOLDER_ID')
  })

  it('does not report ready when the folder is wrong', () => {
    const { api, logs } = runScript(scriptWithSetup(codeGs, 'cartellaSbagliata123', TOKEN), plans())
    api.setup()
    expect(logs.join('\n')).toContain('non trovata')
    expect(logs.join('\n')).not.toContain('Pronto')
  })

  it('creates the data file next to the plans, with its own identity', () => {
    const { files, logs } = setUpScript(TOKEN, plans())
    expect(storedData(files)).toMatchObject({ format: 'training-data', epoch: 'epoch-1', rev: 0, sessions: {} })
    expect(logs.join('\n')).toContain(DATA_FILE)
  })

  it('explains a read-only authorization instead of failing', () => {
    const { files, logs } = setUpScript(TOKEN, plans(), { readOnly: true })
    expect(files.some((f) => f.name === DATA_FILE)).toBe(false)
    expect(logs.join('\n')).toContain('drive.readonly')
  })
})

describe('Apps Script doPost() — logs saved on Drive', () => {
  const session = (notes = '', updatedAt = 100) => ({
    date: DAY,
    planId: '2026-10-01',
    dayType: 'SPINTA',
    dayTitle: null,
    startedAt: null,
    finishedAt: null,
    elbowPre: null,
    elbowOverride: null,
    rpe: null,
    elbowDuring: null,
    notes,
    skipped: false,
    exercises: {},
    updatedAt,
  })
  const pin = { url: 'https://youtu.be/abcdefghijk', addedAt: 'x', updatedAt: 5 }
  const sync = (epoch: string | null, since: number, changes: unknown = {}) => ({ action: 'sync', v: 2, epoch, since, changes })
  const keys = (list: Record<string, string[]>) => ({ sessions: [], days: [], pins: [], ...list })

  it('rejects a wrong token and a malformed body', () => {
    const script = setUpScript(TOKEN, plans())
    expect(post(script, sync(null, 0), 'sbagliato')).toEqual({ error: 'unauthorized' })
    expect(JSON.parse(script.api.doPost({ parameter: { token: TOKEN }, postData: { contents: 'ciao' } }).text)).toEqual({
      error: 'invalid_request',
    })
    expect(post(script, { action: 'altro' }, TOKEN)).toEqual({ error: 'invalid_request' })
  })

  it('a device new to the file starts over: its records are accepted, the file identity is returned', () => {
    const script = setUpScript(TOKEN, plans())
    const first = post(script, sync(null, 0, { sessions: { [DAY]: session('A') } }), TOKEN)
    expect(first).toMatchObject({ ok: true, epoch: 'epoch-1', rev: 1, reset: true })
    expect(first.accepted).toEqual(keys({ sessions: [DAY] }))
    expect(first.conflicts).toEqual(keys({}))
    // Its own upload is not sent back.
    expect(first.records.sessions).toEqual({})
    expect(storedData(script.files)).toMatchObject({ rev: 1, sessions: { [DAY]: { notes: 'A', _rev: 1 } } })

    // Another device: gets everything, without the internal revision.
    const other = post(script, sync(null, 0), TOKEN)
    expect(other).toMatchObject({ rev: 1, reset: true })
    expect(other.records.sessions[DAY]).toMatchObject({ notes: 'A', updatedAt: 100 })
    expect(other.records.sessions[DAY]._rev).toBeUndefined()
    // Up to date: nothing new, nothing written.
    const quiet = post(script, sync('epoch-1', 1), TOKEN)
    expect(quiet).toMatchObject({ rev: 1, reset: false })
    expect(quiet.records).toEqual({ sessions: {}, days: {}, pins: {} })
  })

  it('accepts a change only from a device that had seen the latest version, otherwise reports a conflict', () => {
    const script = setUpScript(TOKEN, plans())
    post(script, sync('epoch-1', 0, { sessions: { [DAY]: session('iPhone') } }), TOKEN)
    // The Mac had synced before that (rev 0): its copy would overwrite the iPhone's one.
    const stale = post(script, sync('epoch-1', 0, { sessions: { [DAY]: session('Mac', 999_999) } }), TOKEN)
    expect(stale.conflicts).toEqual(keys({ sessions: [DAY] }))
    expect(stale.accepted).toEqual(keys({}))
    expect(stale.rev).toBe(1)
    // …and gets the stored version to merge with.
    expect(stale.records.sessions[DAY].notes).toBe('iPhone')
    expect(storedData(script.files).sessions[DAY].notes).toBe('iPhone')
    // The merge, sent from rev 1, is accepted.
    const merged = post(script, sync('epoch-1', 1, { sessions: { [DAY]: session('iPhone\nMac', 1) } }), TOKEN)
    expect(merged).toMatchObject({ rev: 2, accepted: keys({ sessions: [DAY] }) })
    expect(storedData(script.files).sessions[DAY].notes).toBe('iPhone\nMac')
  })

  it('stores deletions and passes them on', () => {
    const script = setUpScript(TOKEN, plans())
    post(script, sync('epoch-1', 0, { pins: { dip: pin } }), TOKEN)
    const del = post(script, sync('epoch-1', 1, { pins: { dip: { deleted: true, updatedAt: 9 } } }), TOKEN)
    expect(del).toMatchObject({ rev: 2, accepted: keys({ pins: ['dip'] }) })
    expect(post(script, sync('epoch-1', 1), TOKEN).records.pins).toEqual({ dip: { deleted: true, updatedAt: 9 } })
  })

  it('starts over when the device knows a newer revision than the file', () => {
    const script = setUpScript(TOKEN, plans())
    post(script, sync('epoch-1', 0, { pins: { dip: pin } }), TOKEN)
    const r = post(script, sync('epoch-1', 42), TOKEN)
    expect(r.reset).toBe(true)
    expect(Object.keys(r.records.pins)).toEqual(['dip'])
  })

  it('a file restored to an older version gets a new identity: every device merges with it again', () => {
    const script = setUpScript(TOKEN, plans())
    post(script, sync('epoch-1', 0, { pins: { dip: pin } }), TOKEN)
    const file = script.files.find((f) => f.name === DATA_FILE)!
    const version1 = file.text
    post(script, sync('epoch-1', 1, { days: { [DAY]: { date: DAY, weightKg: 72, updatedAt: 7 } } }), TOKEN)
    expect(script.props.DATA_REV).toBe('2')

    file.text = version1 // "Gestisci versioni" on Drive
    const r = post(script, sync('epoch-1', 1), TOKEN)
    // Revisions go on from the highest one: a number is never reused for other records.
    expect(r).toMatchObject({ reset: true, rev: 2 })
    expect(r.epoch).not.toBe('epoch-1')
    expect(Object.keys(r.records.pins)).toEqual(['dip'])
    expect(storedData(script.files).epoch).toBe(r.epoch)
    expect(script.props.DATA_REV).toBe('2')
    // Later devices see the same new identity, no further reset.
    expect(post(script, sync(r.epoch, 2), TOKEN)).toMatchObject({ reset: false, epoch: r.epoch })
  })

  it('two restores in a row never let a device miss records', () => {
    const script = setUpScript(TOKEN, plans())
    const file = () => script.files.find((f) => f.name === DATA_FILE)!
    const day = (date: string, weightKg: number) => ({ date, weightKg, elbowNextMorning: null, sleepH: null, updatedAt: 1 })
    post(script, sync('epoch-1', 0, { days: { '2026-10-01': day('2026-10-01', 71) } }), TOKEN)
    const v1 = file().text
    post(script, sync('epoch-1', 1, { days: { '2026-10-02': day('2026-10-02', 72) } }), TOKEN)
    const v2 = file().text
    const seen = post(script, sync('epoch-1', 2, { days: { '2026-10-03': day('2026-10-03', 73) } }), TOKEN)
    file().text = v1 // restore an older version…
    const a = post(script, sync('epoch-1', 1), TOKEN)
    file().text = v2 // …then a newer one again: same identity as before, lower revision
    const b = post(script, sync(a.epoch, a.rev), TOKEN)
    post(script, sync(b.epoch, b.rev, { days: { '2026-10-05': day('2026-10-05', 75) } }), TOKEN)
    const back = post(script, sync(seen.epoch, seen.rev), TOKEN)
    expect(back.reset || Object.keys(back.records.days).includes('2026-10-05')).toBe(true)
    expect(Number(script.props.DATA_REV)).toBeGreaterThanOrEqual(seen.rev)
  })

  it('a deleted data file is created again, with a new identity', () => {
    const script = setUpScript(TOKEN, plans())
    post(script, sync('epoch-1', 0, { pins: { dip: pin } }), TOKEN)
    script.files.splice(script.files.findIndex((f) => f.name === DATA_FILE), 1)
    const r = post(script, sync('epoch-1', 1, { days: { [DAY]: { date: DAY, weightKg: 72, updatedAt: 7 } } }), TOKEN)
    expect(r).toMatchObject({ ok: true, reset: true, rev: 2, accepted: keys({ days: [DAY] }) })
    expect(r.epoch).not.toBe('epoch-1')
    expect(storedData(script.files)).toMatchObject({ epoch: r.epoch, pins: {}, days: { [DAY]: { weightKg: 72 } } })
  })

  it('a file edited by hand with revisions above its own never makes devices conflict forever', () => {
    const script = setUpScript(TOKEN, plans())
    const file = script.files.find((f) => f.name === DATA_FILE)!
    file.text = JSON.stringify({ ...JSON.parse(file.text), rev: 1, pins: { dip: { ...pin, _rev: 5 } } })
    const first = post(script, sync('epoch-1', 0), TOKEN)
    expect(first.rev).toBe(5)
    const change = post(script, sync('epoch-1', first.rev, { pins: { dip: { ...pin, url: 'https://youtu.be/zzzzzzzzzzz' } } }), TOKEN)
    expect(change).toMatchObject({ rev: 6, accepted: keys({ pins: ['dip'] }) })
  })

  it('never overwrites a data file it cannot read', () => {
    const script = setUpScript(TOKEN, [...plans(), { name: DATA_FILE, text: '{rotto', updated: 9_999_999 }])
    expect(post(script, sync('epoch-1', 0, { sessions: { [DAY]: session() } }), TOKEN)).toEqual({ error: 'data_corrupt' })
    expect(script.files.filter((f) => f.name === DATA_FILE).some((f) => f.text === '{rotto')).toBe(true)
  })

  it('answers busy when another sync holds the lock, and explains a read-only script', () => {
    expect(post(setUpScript(TOKEN, plans(), { busy: true }), sync(null, 0), TOKEN)).toEqual({ error: 'busy' })
    const readOnly = runScript(scriptWithSetup(codeGs, DEFAULT_FOLDER_ID, TOKEN), plans(), {
      readOnly: true,
      initialProps: { FOLDER_ID: DEFAULT_FOLDER_ID, TOKEN },
    })
    expect(post(readOnly, sync(null, 0, { days: { [DAY]: { date: DAY, weightKg: 73, updatedAt: 1 } } }), TOKEN)).toEqual({
      error: 'no_write_permission',
    })
  })
})
