import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { createBackup, parseBackup } from '../lib/backup'
import { parsePlan } from '../plan/schema'
import { DATA_FILE, post, setUpScript, storedData, type FakeFile, type Script } from '../test/appsScript'
import {
  clearAllData,
  deleteSession,
  replaceAllData,
  resetExercise,
  setPin,
  setPlan,
  updateDayLog,
  updateSessionMeta,
  updateSet,
  updateSettings,
} from './actions'
import {
  __settleSyncForTests,
  clearThisDevice,
  deleteLogsEverywhere,
  importBackup,
  retryUnreadableRecords,
  syncData,
  unreadableCount,
  type SyncOptions,
} from './dataSync'
import { __setStateForTests, defaultData, getState } from './store'
import type { AppData } from './types'
import { toast } from './ui'

vi.mock('./ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ui')>()
  return { ...actual, toast: vi.fn(actual.toast) }
})

/*
 * Several devices syncing with the real apps-script/Code.gs (fake Drive). Each device has its own
 * data and clock; the shared store holds the data of the device acting.
 */

const TOKEN = 'Zq3-xY_9kLmN0pQrStUvWxYz0123456789'
const EXEC = 'https://script.google.com/macros/s/X/exec'
const DAY = '2026-10-01'
const T = Date.UTC(2026, 9, 1, 8, 0, 0)
const plan = (() => {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
})()
const plans = (): FakeFile[] => [{ name: 'scheda-2026-10-01.json', text: JSON.stringify(fixture) }]

interface Device {
  clockOffset: number
  state: AppData
}

function device(clockOffset = 0, patch: Partial<AppData> = {}): Device {
  const base = defaultData()
  return {
    clockOffset,
    state: { ...base, plan, settings: { ...base.settings, endpoint: EXEC, token: TOKEN }, ...patch },
  }
}

/**
 * fetch -> the fake web app. hold(): the next answer reaches the app only after release().
 * dropNext(): Drive runs the next request but its answer is lost (timeout, connection dropped).
 */
function network(script: Script) {
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  let drop = false
  const calls: { body: { epoch: string | null; since: number; changes: Record<string, Record<string, unknown>> }; keepalive?: boolean }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const token = new URL(url).searchParams.get('token')
    calls.push({ body: JSON.parse(String(init.body)), keepalive: init.keepalive })
    // Apps Script runs when the request arrives; the answer may reach the app later.
    const out = script.api.doPost({ parameter: { token }, postData: { contents: String(init.body) } })
    if (gate) {
      const wait = gate
      gate = null
      await wait
    }
    if (drop) {
      drop = false
      throw new TypeError('Load failed')
    }
    return new Response(out.text, { status: 200 })
  })
  return {
    calls,
    dropNext() {
      drop = true
    },
    hold() {
      gate = new Promise<void>((resolve) => (open = resolve))
    },
    release() {
      open?.()
    },
  }
}

/** Something done on the device (with its clock and its data). */
function on(dev: Device, at: number, fn: () => void): void {
  vi.setSystemTime(at + dev.clockOffset)
  __setStateForTests(dev.state)
  fn()
  dev.state = getState()
}

/** One sync of the device, with the follow-up rounds (merges to send). */
async function sync(dev: Device, at: number, opts: SyncOptions = {}) {
  vi.setSystemTime(at + dev.clockOffset)
  __setStateForTests(dev.state)
  const outcome = await syncData(opts)
  await vi.advanceTimersByTimeAsync(5_000)
  await __settleSyncForTests()
  dev.state = getState()
  return outcome
}

const setValues = (s: AppData['sessions'][string] | undefined, ex = '7') => s?.exercises[ex]?.sets.map((x) => x.value)
const setDone = (s: AppData['sessions'][string] | undefined) => s?.exercises['7']?.sets.map((x) => x.done)

function session(notes: string): AppData['sessions'][string] {
  return {
    date: DAY,
    planId: plan.id,
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
  }
}

let script: Script
let net: ReturnType<typeof network>

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(toast).mockClear()
  script = setUpScript(TOKEN, plans())
  net = network(script)
})

afterEach(async () => {
  await __settleSyncForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  __setStateForTests(defaultData())
})

describe('two devices, one Drive file', () => {
  it('a device with old data never wipes a workout logged on another one', async () => {
    const phone = device()
    const mac = device()
    await sync(mac, T) // the Mac is synced, then left open without syncing
    await sync(phone, T + 1_000)
    on(phone, T + 60_000, () => {
      updateSet(DAY, 7, 0, { done: true, value: 10 })
      updateSet(DAY, 7, 1, { done: true, value: 9 })
    })
    await sync(phone, T + 70_000)
    // An hour later, on the Mac that never saw the workout.
    on(mac, T + 3_600_000, () => updateSessionMeta(DAY, { notes: 'buona sessione' }))
    await sync(mac, T + 3_606_000)
    await sync(phone, T + 3_700_000)

    for (const s of [storedData(script.files).sessions[DAY], phone.state.sessions[DAY], mac.state.sessions[DAY]]) {
      expect(s.notes).toBe('buona sessione')
      expect(setValues(s)).toEqual([10, 9])
    }
    expect(phone.state.sync.pending.sessions).toEqual({})
    expect(mac.state.sync.pending.sessions).toEqual({})
  })

  it('the diary too: weight logged on the iPhone and sleep typed on the Mac are both kept', async () => {
    const phone = device()
    const mac = device()
    await sync(mac, T)
    on(phone, T + 60_000, () => updateDayLog(DAY, { weightKg: 72.4 }))
    await sync(phone, T + 70_000)
    on(mac, T + 600_000, () => updateDayLog(DAY, { sleepH: 7.5 }))
    await sync(mac, T + 606_000)
    await sync(phone, T + 700_000)
    for (const d of [storedData(script.files).days[DAY], phone.state.days[DAY], mac.state.days[DAY]]) {
      expect(d).toMatchObject({ weightKg: 72.4, sleepH: 7.5 })
    }
  })

  it('sets logged on both devices at the same time are merged', async () => {
    const phone = device()
    const mac = device()
    await sync(phone, T)
    await sync(mac, T)
    on(phone, T + 60_000, () => updateSet(DAY, 7, 0, { done: true, value: 10 }))
    on(mac, T + 61_000, () => updateSet(DAY, 7, 1, { done: true, value: 8 }))
    await sync(phone, T + 70_000)
    await sync(mac, T + 71_000)
    await sync(phone, T + 80_000)
    expect(setValues(storedData(script.files).sessions[DAY])).toEqual([10, 8])
    expect(setValues(phone.state.sessions[DAY])).toEqual([10, 8])
    expect(setValues(mac.state.sessions[DAY])).toEqual([10, 8])
  })

  it('device clocks never decide: a later edit on a device whose clock is behind is kept', async () => {
    const phone = device(+3_600_000) // an hour ahead
    const mac = device()
    on(phone, T, () => updateSessionMeta(DAY, { notes: 'A' }))
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    expect(mac.state.sessions[DAY].notes).toBe('A')
    on(mac, T + 10_000, () => updateSessionMeta(DAY, { notes: 'B, più recente' }))
    await sync(mac, T + 20_000)
    await sync(phone, T + 30_000)
    expect(storedData(script.files).sessions[DAY].notes).toBe('B, più recente')
    expect(phone.state.sessions[DAY].notes).toBe('B, più recente')
    expect(mac.state.sync.pending.sessions).toEqual({})
  })

  it('records saved before sync existed, different on two devices, end up the same everywhere', async () => {
    const legacy = (notes: string) => ({
      date: DAY,
      planId: plan.id,
      dayType: 'SPINTA' as const,
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
    })
    const phone = device(0, { sessions: { [DAY]: legacy('iPhone') } })
    const mac = device(0, { sessions: { [DAY]: legacy('Mac') } })
    await sync(phone, T)
    await sync(mac, T + 1_000)
    await sync(phone, T + 2_000)
    const notes = storedData(script.files).sessions[DAY].notes
    expect(notes.split('\n').sort()).toEqual(['Mac', 'iPhone'])
    expect(phone.state.sessions[DAY].notes).toBe(notes)
    expect(mac.state.sessions[DAY].notes).toBe(notes)
  })

  it('an edit always beats a deletion made on another device', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => updateSessionMeta(DAY, { notes: 'x' }))
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    on(phone, T + 10_000, () => deleteSession(DAY))
    on(mac, T + 11_000, () => updateSessionMeta(DAY, { notes: 'x, poi corretta' }))
    await sync(phone, T + 20_000)
    await sync(mac, T + 21_000)
    await sync(phone, T + 30_000)
    expect(storedData(script.files).sessions[DAY].notes).toBe('x, poi corretta')
    expect(phone.state.sessions[DAY].notes).toBe('x, poi corretta')
  })
})

describe('races and resets', () => {
  it('"Cancella" while a sync is on its way: the data comes back from Drive', async () => {
    const phone = device()
    on(phone, T, () => updateSet(DAY, 7, 0, { done: true, value: 10 }))
    await sync(phone, T + 1_000)
    on(phone, T + 2_000, () => updateSessionMeta('2026-10-02', { notes: 'tirata' }))
    // A background upload is on its way…
    vi.setSystemTime(T + 10_000)
    __setStateForTests(phone.state)
    net.hold()
    const flight = syncData({ onlyIfPending: true })
    // …when "Cancella tutti i dati" is confirmed.
    clearAllData(true)
    void syncData()
    net.release()
    await flight
    await vi.advanceTimersByTimeAsync(5_000)
    await __settleSyncForTests()
    expect(Object.keys(getState().sessions).sort()).toEqual([DAY, '2026-10-02'])
    expect(setValues(getState().sessions[DAY])).toEqual([10])
  })

  it('a backup imported while a sync is on its way still reaches Drive', async () => {
    const phone = device()
    const mac = device()
    await sync(phone, T)
    on(phone, T + 1_000, () => updateSessionMeta('2026-10-02', { notes: 'x' }))
    vi.setSystemTime(T + 10_000)
    __setStateForTests(phone.state)
    net.hold()
    const flight = syncData({ onlyIfPending: true })
    const backup = device(0, { sessions: { [DAY]: { ...phone.state.sessions['2026-10-02'], date: DAY, notes: 'dal backup' } } })
    replaceAllData(backup.state)
    net.release()
    await flight
    await vi.advanceTimersByTimeAsync(5_000)
    await __settleSyncForTests()
    expect(storedData(script.files).sessions[DAY].notes).toBe('dal backup')
    // The session uploaded by the ignored reply is not in the backup: it goes.
    expect(getState().sessions['2026-10-02']).toBeUndefined()
    expect(storedData(script.files).sessions['2026-10-02']).toMatchObject({ deleted: true })
    await sync(mac, T + 60_000)
    expect(mac.state.sessions[DAY].notes).toBe('dal backup')
  })

  it('a backup brings back on Drive a session deleted after it was made', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => updateSessionMeta(DAY, { notes: 'allenamento vero' }))
    await sync(phone, T + 1_000)
    await sync(mac, T + 1_500)
    const backup = createBackup(phone.state, new Date(T + 2_000).toISOString())
    on(phone, T + 100_000, () => deleteSession(DAY))
    await sync(phone, T + 110_000)
    await sync(mac, T + 120_000)
    expect(mac.state.sessions[DAY]).toBeUndefined()

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)), TOKEN)
    if (!parsed.ok) throw new Error(parsed.error)
    on(phone, T + 200_000, () => replaceAllData({ ...parsed.data, settings: phone.state.settings }))
    await sync(phone, T + 210_000)
    await sync(mac, T + 220_000)
    expect(storedData(script.files).sessions[DAY].notes).toBe('allenamento vero')
    expect(mac.state.sessions[DAY].notes).toBe('allenamento vero')
  })

  it('data file deleted on Drive: each device puts its records back in the new one', async () => {
    const phone = device()
    const mac = device()
    await sync(phone, T)
    await sync(mac, T + 500)
    on(mac, T + 1_000, () => setPin('dip', 'https://youtu.be/abcdefghijk'))
    await sync(mac, T + 2_000)
    script.files.splice(script.files.findIndex((f) => f.name === DATA_FILE), 1)
    for (let i = 0; i < 3; i++) {
      on(phone, T + 10_000 + i * 60_000, () => updateDayLog(DAY, { weightKg: 70 + i }))
      await sync(phone, T + 20_000 + i * 60_000)
    }
    await sync(mac, T + 900_000)
    await sync(phone, T + 910_000)
    expect(Object.keys(storedData(script.files).pins)).toEqual(['dip'])
    expect(storedData(script.files).days[DAY].weightKg).toBe(72)
    expect(Object.keys(phone.state.pins)).toEqual(['dip'])
    expect(mac.state.days[DAY].weightKg).toBe(72)
  })

  it('data file restored to an older version on Drive: the newer records come back from the devices', async () => {
    const phone = device()
    on(phone, T, () => updateDayLog(DAY, { weightKg: 71 }))
    await sync(phone, T + 1_000)
    const file = script.files.find((f) => f.name === DATA_FILE)!
    const older = file.text
    on(phone, T + 2_000, () => updateDayLog('2026-10-02', { weightKg: 70.5 }))
    await sync(phone, T + 3_000)
    file.text = older // "Gestisci versioni" on Drive
    await sync(phone, T + 60_000)
    expect(storedData(script.files).days).toMatchObject({ [DAY]: { weightKg: 71 }, '2026-10-02': { weightKg: 70.5 } })
  })

  it('records an older app version cannot read are never overwritten, and downloaded again once updated', async () => {
    // A newer app version saved a session with a day type this version does not know.
    const newer = { ...session('versione nuova'), dayType: 'NUOVO', updatedAt: T - 1 }
    post(script, { action: 'sync', v: 2, epoch: null, since: 0, changes: { sessions: { [DAY]: newer } } }, TOKEN)
    const mac = device()
    await sync(mac, T)
    expect(mac.state.sessions[DAY]).toBeUndefined()
    expect(unreadableCount(mac.state)).toBe(1)
    // Still remembered after the next poll.
    await sync(mac, T + 180_000)
    expect(unreadableCount(mac.state)).toBe(1)
    // The day looks empty here: a set logged on it stays on this device, Drive keeps the newer version.
    on(mac, T + 200_000, () => updateSet(DAY, 7, 0, { done: true, value: 5 }))
    await sync(mac, T + 210_000)
    expect(storedData(script.files).sessions[DAY]).toMatchObject({ dayType: 'NUOVO', notes: 'versione nuova' })
    expect(Object.keys(mac.state.sync.pending.sessions)).toEqual([DAY])
    // App updated: the next sync downloads everything again, same file identity.
    on(mac, T + 300_000, () => retryUnreadableRecords('build-successiva'))
    await sync(mac, T + 301_000)
    expect(net.calls.at(-1)?.body).toMatchObject({ epoch: mac.state.sync.epoch, since: 0 })
    expect(Object.keys(net.calls.at(-1)?.body.changes.sessions ?? {})).toEqual([])
  })
})

describe('a reply lost after Drive saved the upload', () => {
  /* Drive applies an upload but the answer never reaches the app; the next sync re-sends the record
     with the old revision and gets its own upload back as a conflict. It must not be mistaken for a
     change made on another device. */
  async function lostReply(prepare: () => void, edit: () => void, after: () => void) {
    const phone = device()
    on(phone, T, prepare)
    await sync(phone, T + 1_000)
    on(phone, T + 60_000, edit)
    net.dropNext()
    expect(await sync(phone, T + 61_000)).toBe('error')
    on(phone, T + 120_000, after)
    await sync(phone, T + 130_000)
    return phone
  }

  it('a set un-ticked afterwards stays un-ticked', async () => {
    const phone = await lostReply(
      () => updateSessionMeta(DAY, { notes: 'inizio' }),
      () => updateSet(DAY, 7, 0, { done: true, value: 10 }),
      () => updateSet(DAY, 7, 0, { done: false }),
    )
    expect(setDone(phone.state.sessions[DAY])).toEqual([false])
    expect(setDone(storedData(script.files).sessions[DAY])).toEqual([false])
  })

  it('a session deleted afterwards stays deleted', async () => {
    const phone = await lostReply(
      () => {},
      () => updateSet(DAY, 7, 0, { done: true, value: 10 }),
      () => deleteSession(DAY),
    )
    expect(phone.state.sessions[DAY]).toBeUndefined()
    expect(storedData(script.files).sessions[DAY]).toMatchObject({ deleted: true })
  })

  it('an exercise reset afterwards stays reset', async () => {
    const phone = await lostReply(
      () => updateSet(DAY, 7, 0, { done: true, value: 10 }),
      () => updateSet(DAY, 8, 0, { done: true, value: 5 }),
      () => resetExercise(DAY, 8),
    )
    expect(phone.state.sessions[DAY].exercises['8']).toBeUndefined()
    expect(storedData(script.files).sessions[DAY].exercises['8']).toBeUndefined()
  })

  it('a note rewritten afterwards replaces the old one', async () => {
    const phone = await lostReply(
      () => updateSessionMeta(DAY, { notes: 'spalla ok' }),
      () => updateSessionMeta(DAY, { notes: 'gomito dolorante' }),
      () => updateSessionMeta(DAY, { notes: 'tutto ok, era il polso' }),
    )
    expect(phone.state.sessions[DAY].notes).toBe('tutto ok, era il polso')
    expect(storedData(script.files).sessions[DAY].notes).toBe('tutto ok, era il polso')
  })

  it('a pin removed afterwards stays removed', async () => {
    const phone = await lostReply(
      () => {},
      () => setPin('dip', 'https://youtu.be/abcdefghijk'),
      () => setPin('dip', null),
    )
    expect(phone.state.pins).toEqual({})
    expect(storedData(script.files).pins.dip).toMatchObject({ deleted: true })
  })
})

describe('more fixes from review', () => {
  it('a new link to the same script (new deployment) keeps a device that is behind in step', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => {
      updateSessionMeta(DAY, { notes: 'gomito dolorante' })
      updateSet(DAY, 7, 0, { done: true, value: 10 })
      updateSessionMeta('2026-10-02', { notes: 'giorno sbagliato' })
    })
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    on(mac, T + 3_000, () => setPin('dip', 'https://youtu.be/abcdefghijk'))
    await sync(mac, T + 4_000)
    // The phone changes its mind; the Mac does not sync meanwhile.
    on(phone, T + 60_000, () => {
      updateSessionMeta(DAY, { notes: 'era il polso, gomito ok' })
      updateSet(DAY, 7, 0, { done: false })
      deleteSession('2026-10-02')
    })
    await sync(phone, T + 61_000)
    on(mac, T + 80_000, () => setPin('dip', null)) // not uploaded yet
    on(mac, T + 120_000, () => updateSettings({ endpoint: 'https://script.google.com/macros/s/NUOVO-DEPLOYMENT/exec' }))
    await sync(mac, T + 121_000)
    await sync(phone, T + 180_000)
    for (const d of [phone, mac]) {
      expect(d.state.sessions[DAY].notes).toBe('era il polso, gomito ok')
      expect(setDone(d.state.sessions[DAY])).toEqual([false])
      expect(d.state.sessions['2026-10-02']).toBeUndefined()
      expect(d.state.pins).toEqual({})
    }
  })

  it('a plan changed on one device only: sets stay with their exercise', async () => {
    const day = plan.days.find((d) => d.date === DAY)!
    const swapped = [...day.exercises]
    ;[swapped[7], swapped[8]] = [swapped[8], swapped[7]]
    const plan2 = { ...plan, days: plan.days.map((d) => (d.date === DAY ? { ...d, exercises: swapped } : d)) }
    const phone = device()
    const mac = device()
    on(phone, T, () => {
      updateSet(DAY, 7, 0, { done: true, value: 10 }) // pike push-up
      updateSet(DAY, 8, 0, { done: true, value: 20 }) // piegamenti
    })
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    on(mac, T + 3_000, () => setPlan(plan2, 'remote'))
    on(phone, T + 60_000, () => updateSet(DAY, 7, 1, { done: true, value: 11 })) // old plan here
    on(mac, T + 61_000, () => updateSessionMeta(DAY, { notes: 'spalla ok' }))
    await sync(mac, T + 62_000)
    await sync(phone, T + 70_000)
    await sync(mac, T + 80_000)
    const byKey = (s: AppData['sessions'][string], key: string) =>
      Object.values(s.exercises).filter((l) => l.key === key).map((l) => l.sets.map((x) => x.value))
    for (const s of [storedData(script.files).sessions[DAY], phone.state.sessions[DAY], mac.state.sessions[DAY]]) {
      expect(byKey(s, 'pike-push-up')).toEqual([[10, 11]])
      expect(byKey(s, 'piegamenti-parallettes')).toEqual([[20]])
      expect(s.notes).toBe('spalla ok')
    }
    // Each device keeps its own numbering.
    expect(mac.state.sessions[DAY].exercises['8'].key).toBe('pike-push-up')
    expect(phone.state.sessions[DAY].exercises['7'].key).toBe('pike-push-up')
  })

  it('a value fixed on one device and a set logged on another are both kept', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => updateSet(DAY, 7, 0, { done: true, value: 10 }))
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    on(mac, T + 60_000, () => updateSet(DAY, 7, 0, { value: 12 })) // typo fixed
    on(phone, T + 61_000, () => updateSet(DAY, 7, 1, { done: true, value: 9 }))
    await sync(mac, T + 70_000)
    await sync(phone, T + 80_000)
    await sync(mac, T + 90_000)
    expect(setValues(storedData(script.files).sessions[DAY])).toEqual([12, 9])
    expect(setValues(mac.state.sessions[DAY])).toEqual([12, 9])
  })

  it('"Cancella" on this device only saves unsaved changes first, and refuses offline', async () => {
    const phone = device()
    await sync(phone, T)
    on(phone, T + 60_000, () => updateSet(DAY, 7, 0, { done: true, value: 10 }))
    vi.stubGlobal('navigator', { onLine: false })
    __setStateForTests(phone.state)
    expect(await clearThisDevice()).toBe('unsaved')
    expect(setValues(getState().sessions[DAY])).toEqual([10])
    vi.stubGlobal('navigator', { onLine: true })
    expect(await clearThisDevice()).toBe('cleared')
    expect(getState().sessions).toEqual({})
    await syncData()
    await __settleSyncForTests()
    expect(setValues(getState().sessions[DAY])).toEqual([10])
  })

  it('a backup replaces what Drive holds now, records added by other devices included', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => updateSessionMeta(DAY, { notes: 'backup' }))
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    const backup = phone.state
    on(mac, T + 60_000, () => {
      updateSessionMeta(DAY, { notes: 'cambiata sul Mac', rpe: 9 })
      updateSessionMeta('2026-10-02', { notes: 'nuova sul Mac' })
    })
    await sync(mac, T + 70_000)
    vi.setSystemTime(T + 100_000)
    __setStateForTests(phone.state)
    await importBackup({ ...backup, settings: phone.state.settings })
    await vi.advanceTimersByTimeAsync(5_000)
    await syncData()
    await __settleSyncForTests()
    const stored = storedData(script.files).sessions
    expect(stored[DAY]).toMatchObject({ notes: 'backup', rpe: null })
    expect(stored['2026-10-02']).toMatchObject({ deleted: true })
  })
})

describe('delete everywhere', () => {
  it('deletes the logs on Drive and on the other devices; unsaved edits elsewhere survive', async () => {
    const phone = device()
    const mac = device()
    on(phone, T, () => {
      updateSessionMeta(DAY, { notes: 'spinta' })
      updateSessionMeta('2026-10-02', { notes: 'tirata' })
      setPin('dip', 'https://youtu.be/abcdefghijk')
    })
    await sync(phone, T + 1_000)
    await sync(mac, T + 2_000)
    on(mac, T + 3_000, () => updateSessionMeta('2026-10-02', { notes: 'tirata, corretta sul Mac' }))

    vi.setSystemTime(T + 4_000)
    __setStateForTests(phone.state)
    expect(await deleteLogsEverywhere()).toBe('done')
    await __settleSyncForTests()
    phone.state = getState()
    expect(phone.state.sessions).toEqual({})
    expect(phone.state.pins).toEqual({})

    await sync(mac, T + 10_000)
    await sync(phone, T + 11_000)
    expect(Object.keys(mac.state.sessions)).toEqual(['2026-10-02'])
    expect(mac.state.pins).toEqual({})
    expect(Object.keys(phone.state.sessions)).toEqual(['2026-10-02'])
    const stored = storedData(script.files)
    expect(stored.sessions[DAY]).toMatchObject({ deleted: true })
    expect(stored.sessions['2026-10-02'].notes).toBe('tirata, corretta sul Mac')
  })

  it('without Drive nothing is deleted', async () => {
    const phone = device()
    on(phone, T, () => updateSessionMeta(DAY, { notes: 'spinta' }))
    __setStateForTests(phone.state)
    script.options.busy = true
    expect(await deleteLogsEverywhere()).toBe('unreachable')
    expect(Object.keys(getState().sessions)).toEqual([DAY])
  })
})

describe('problems', () => {
  it('Drive busy: retried quietly a minute later', async () => {
    const phone = device()
    on(phone, T, () => updateDayLog(DAY, { weightKg: 72 }))
    __setStateForTests(phone.state)
    script.options.busy = true
    expect(await syncData()).toBe('error')
    expect(getState().sync.lastError).toContain('occupato')
    expect(toast).not.toHaveBeenCalled()
    script.options.busy = false
    await vi.advanceTimersByTimeAsync(61_000)
    expect(getState().sync).toMatchObject({ lastError: null, pending: { days: {} } })
    expect(storedData(script.files).days[DAY].weightKg).toBe(72)
  })

  it('a script to update is reported once, not at every launch', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Funzione script non trovata: doPost</html>', { status: 200 }))
    const phone = device()
    __setStateForTests(phone.state)
    expect(await syncData()).toBe('error')
    expect(await syncData()).toBe('error')
    expect(toast).toHaveBeenCalledTimes(1)
    expect(getState().sync.lastError).toContain('Hai già lo script?')
    // Asked by the user: always answered.
    await syncData({ manual: true })
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('leaving the app sends pending changes with keepalive; a failure there is not an error', async () => {
    const phone = device()
    await sync(phone, T)
    on(phone, T + 1_000, () => updateDayLog(DAY, { weightKg: 72 }))
    __setStateForTests(phone.state)
    expect(await syncData({ onlyIfPending: true, keepalive: true })).toBe('ok')
    expect(net.calls.at(-1)?.keepalive).toBe(true)

    updateDayLog(DAY, { weightKg: 73 })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Load failed')
    })
    expect(await syncData({ onlyIfPending: true, keepalive: true })).toBe('error')
    expect(getState().sync.lastError).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })
})
