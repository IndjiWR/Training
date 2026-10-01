import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import { defaultData } from '../state/store'
import type { AppData, SessionLog } from '../state/types'
import { BACKUP_FORMAT, backupFileName, createBackup, parseBackup, readBackupFile } from './backup'

function samplePlan() {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

function sampleData(): AppData {
  const plan = samplePlan()
  const session: SessionLog = {
    date: '2026-10-02',
    planId: plan.id,
    dayType: 'TIRATA',
    dayTitle: 'Tirata',
    startedAt: '2026-10-02T16:00:00.000Z',
    finishedAt: '2026-10-02T17:10:00.000Z',
    elbowPre: 2,
    elbowOverride: null,
    rpe: 7,
    elbowDuring: 3,
    notes: 'Buona sessione, presa ok',
    skipped: false,
    exercises: {
      '3': {
        index: 3,
        key: 'muscle-up',
        name: 'Muscle-up',
        kind: 'attempts',
        unit: 'rep',
        measure: 'rep',
        test: true,
        perSide: false,
        setsPlanned: 2,
        sets: [
          { done: true, value: 3, at: '2026-10-02T16:20:00.000Z' },
          { done: false, value: null },
        ],
      },
      '5': {
        index: 5,
        key: 'pistol',
        name: 'Pistol squat',
        kind: 'reps',
        unit: 'rep',
        measure: null,
        test: false,
        perSide: true,
        setsPlanned: 1,
        sets: [{ done: true, value: null, dx: { done: true, value: 5 }, sx: { done: true, value: 4 }, at: null }],
        text: 'assistito',
      },
    },
  }
  return {
    ...defaultData(),
    settings: { endpoint: 'https://script.google.com/macros/s/X/exec', token: 'super-secret', theme: 'light', sound: false, vibration: true },
    plan,
    planMeta: { source: 'remote', receivedAt: '2026-10-01T18:00:00.000Z', lastCheckAt: '2026-10-01T18:00:00.000Z', lastError: null },
    sessions: { '2026-10-02': session },
    days: {
      '2026-10-02': { date: '2026-10-02', weightKg: 73.5, elbowNextMorning: 2, sleepH: 7.5 },
      '2026-10-04': { date: '2026-10-04', weightKg: null, elbowNextMorning: null, sleepH: 8 },
    },
    pins: {
      'muscle-up': { url: 'https://www.youtube.com/watch?v=abcdefghijk&t=42', addedAt: '2026-10-01T19:00:00.000Z' },
    },
  }
}

/** What actually goes to disk and back. */
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v))

describe('createBackup', () => {
  it('wraps the data with format/version and blanks the token', () => {
    const data = sampleData()
    const b = createBackup(data, '2026-10-04T09:45:00.000Z')
    expect(b.format).toBe(BACKUP_FORMAT)
    expect(b.version).toBe(1)
    expect(b.exportedAt).toBe('2026-10-04T09:45:00.000Z')
    expect(b.data.settings.token).toBe('')
    expect(JSON.stringify(b)).not.toContain('super-secret')
    // The source data is not mutated.
    expect(data.settings.token).toBe('super-secret')
  })

  it('names the file after the day', () => {
    expect(backupFileName('2026-10-04')).toBe('training-backup-2026-10-04.json')
  })
})

describe('parseBackup', () => {
  it('round-trips sessions, day logs, pins, plan and settings; token comes from the device', () => {
    const data = sampleData()
    const r = parseBackup(roundTrip(createBackup(data, '2026-10-04T09:45:00.000Z')), 'device-token')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.settings).toEqual({ ...data.settings, token: 'device-token' })
    expect(r.data.sessions).toEqual(data.sessions)
    expect(r.data.days).toEqual(data.days)
    expect(r.data.pins).toEqual(data.pins)
    expect(r.data.planMeta).toEqual(data.planMeta)
    expect(r.data.plan).toEqual(data.plan)
    expect(r.data.version).toBe(1)
  })

  it('fills missing optional fields of inner records with defaults', () => {
    const b = roundTrip(createBackup(sampleData(), 'x')) as { data: { sessions: Record<string, Record<string, unknown>> } }
    const s = b.data.sessions['2026-10-02']
    delete s.notes
    delete s.skipped
    delete s.elbowOverride
    delete s.date
    const r = parseBackup(b, '')
    if (!r.ok) throw new Error(r.error)
    const session = r.data.sessions['2026-10-02']
    expect(session.notes).toBe('')
    expect(session.skipped).toBe(false)
    expect(session.elbowOverride).toBeNull()
    expect(session.date).toBe('2026-10-02')
  })

  it('keeps the logs but drops an invalid plan (with lastError)', () => {
    const b = roundTrip(createBackup(sampleData(), 'x')) as { data: { plan: { days: unknown[] } } }
    b.data.plan.days = []
    const r = parseBackup(b, '')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.plan).toBeNull()
    expect(r.data.planMeta.lastError).toMatch(/non contiene giorni/)
    expect(Object.keys(r.data.sessions)).toEqual(['2026-10-02'])
  })

  it('accepts a backup of an empty app', () => {
    const r = parseBackup(roundTrip(createBackup(defaultData(), 'x')), 'tok')
    if (!r.ok) throw new Error(r.error)
    expect(r.data).toEqual({ ...defaultData(), settings: { ...defaultData().settings, token: 'tok' } })
  })

  it('rejects other formats with a clear message', () => {
    const notBackup = parseBackup({ format: 'altro', version: 1, data: {} }, '')
    expect(notBackup).toMatchObject({ ok: false })
    if (!notBackup.ok) expect(notBackup.error).toMatch(/non è un backup di Training/)

    const plan = parseBackup(fixture, '')
    expect(plan).toMatchObject({ ok: false })
    if (!plan.ok) expect(plan.error).toMatch(/è una scheda/)
  })

  it('rejects unsupported versions', () => {
    const b = roundTrip(createBackup(sampleData(), 'x')) as { version: unknown }
    b.version = 2
    const newer = parseBackup(b, '')
    expect(newer.ok).toBe(false)
    if (!newer.ok) expect(newer.error).toMatch(/più recente/)

    b.version = '1'
    const odd = parseBackup(b, '')
    expect(odd.ok).toBe(false)
    if (!odd.ok) expect(odd.error).toMatch(/Versione del backup non supportata/)
  })

  it('rejects garbage shapes without throwing', () => {
    const garbage: unknown[] = [null, undefined, 42, 'testo', [], [1, 2], true]
    for (const g of garbage) {
      const r = parseBackup(g, '')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/backup/)
    }
    const shapes: unknown[] = [
      { format: BACKUP_FORMAT, version: 1 },
      { format: BACKUP_FORMAT, version: 1, data: [] },
      { format: BACKUP_FORMAT, version: 1, data: 'x' },
      { format: BACKUP_FORMAT, version: 1, data: {} },
    ]
    for (const s of shapes) expect(parseBackup(s, '').ok).toBe(false)
  })

  it('rejects broken inner records with the path of the problem', () => {
    const cases: Array<(d: Record<string, any>) => void> = [
      (d) => (d.sessions = []),
      (d) => (d.sessions['2026-10-02'] = 'x'),
      (d) => (d.sessions['2026-10-02'].exercises = 5),
      (d) => (d.sessions['2026-10-02'].exercises['3'].sets = { 0: {} }),
      (d) => (d.sessions['2026-10-02'].exercises['3'].sets[0].value = 'tre'),
      (d) => (d.sessions['2026-10-02'].exercises['3'].kind = 'sprint'),
      (d) => (d.sessions['ieri'] = d.sessions['2026-10-02']),
      (d) => (d.days['2026-10-02'] = null),
      (d) => (d.days['2026-10-02'].weightKg = '73'),
      (d) => (d.pins['muscle-up'] = { url: 'javascript:alert(1)' }),
      (d) => (d.pins = null),
      (d) => (d.settings = null),
      (d) => (d.settings.theme = 'blu'),
    ]
    for (const mutate of cases) {
      const b = roundTrip(createBackup(sampleData(), 'x')) as { data: Record<string, any> }
      mutate(b.data)
      const r = parseBackup(b, '')
      expect(r.ok, mutate.toString()).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/^Il backup è danneggiato o incompleto:\n• /)
    }
  })
})

describe('readBackupFile', () => {
  it('reads a backup file', async () => {
    const text = JSON.stringify(createBackup(sampleData(), 'x'), null, 2)
    const r = await readBackupFile(new File([text], backupFileName('2026-10-04')), 'tok')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.settings.token).toBe('tok')
  })

  it('explains a file that is not JSON', async () => {
    const r = await readBackupFile(new File(['ciao'], 'x.json'), '')
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/non è un JSON valido/)
  })
})
