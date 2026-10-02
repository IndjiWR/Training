import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import {
  clearAllData,
  deleteAllLogs,
  deleteSession,
  replaceAllData,
  setPin,
  startSession,
  updateDayLog,
  updateSessionMeta,
  updateSet,
  updateSettings,
} from '../state/actions'
import { __setStateForTests, defaultData, defaultSync, getState } from '../state/store'
import type { AppData, ExerciseLog, SessionLog, SetLog } from '../state/types'
import {
  applySyncResponse,
  collectChanges,
  emptyRecords,
  isTemporary,
  merge3,
  nextStamp,
  noteSent,
  postSync,
  same,
  stampOf,
  type SyncOk,
} from './dataSync'

const plan = (() => {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
})()
const DAY = '2026-10-01'
const EXEC = 'https://script.google.com/macros/s/X/exec'
const NOW = Date.UTC(2026, 9, 1, 9, 0, 0)

type Rec = Record<string, unknown>

function session(notes = '', patch: Partial<SessionLog> = {}): SessionLog {
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
    ...patch,
  }
}

function log(sets: SetLog[], patch: Partial<ExerciseLog> = {}): ExerciseLog {
  return {
    index: 7,
    key: 'pike-push-up',
    name: 'Pike push-up',
    kind: 'reps',
    unit: 'rep',
    measure: null,
    test: false,
    perSide: false,
    setsPlanned: 3,
    sets,
    ...patch,
  }
}

const done = (value: number, at = '2026-10-01T09:00:00.000Z'): SetLog => ({ done: true, value, at })
const open: SetLog = { done: false, value: null, at: null }

function data(patch: Partial<AppData> = {}, sync: Partial<AppData['sync']> = {}): AppData {
  const base = defaultData()
  return {
    ...base,
    plan,
    settings: { ...base.settings, endpoint: EXEC, token: 'tok' },
    ...patch,
    sync: { ...base.sync, ...sync },
  }
}

const rec = (v: unknown) => v as Rec

describe('same / stamps', () => {
  it('ignores key order, the record stamp and missing vs null', () => {
    expect(same({ a: 1, b: { c: null }, updatedAt: 5 }, { b: {}, a: 1, updatedAt: 9 })).toBe(true)
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    // Only the record's own stamp is metadata.
    expect(same({ x: { updatedAt: 1 } }, { x: { updatedAt: 2 } })).toBe(false)
  })

  it('stampOf: missing or invalid times count as the oldest; nextStamp always moves forward', () => {
    expect(stampOf(undefined)).toBe(1)
    expect(stampOf({ updatedAt: -5 })).toBe(1)
    expect(stampOf({ updatedAt: 42 })).toBe(42)
    // A record stamped by a device whose clock runs ahead.
    const future = Date.now() + 3_600_000
    expect(nextStamp({ updatedAt: future })).toBe(future + 1)
  })
})

describe('merge3 (two devices changed the same record)', () => {
  const withSets = (notes: string, sets: SetLog[], patch: Partial<SessionLog> = {}) =>
    rec(session(notes, { exercises: { '7': log(sets) }, ...patch }))

  it('takes the side that changed', () => {
    const base = rec(session('base'))
    const changed = rec(session('nuova'))
    expect(merge3('sessions', base, base, changed)).toBe(changed)
    expect(merge3('sessions', base, changed, base)).toBe(changed)
  })

  it('keeps the changes of both sides, field by field', () => {
    const base = rec(session())
    const local = rec(session('', { rpe: 8 }))
    const remote = withSets('', [done(10)])
    const m = merge3('sessions', base, local, remote) as unknown as SessionLog
    expect(m.rpe).toBe(8)
    expect(m.exercises['7'].sets).toEqual([done(10)])
  })

  it('never drops a logged set: sets logged on two devices are merged one by one', () => {
    const base = withSets('', [])
    const local = withSets('', [done(10), open])
    const remote = withSets('', [open, done(9)])
    const m = merge3('sessions', base, local, remote) as unknown as SessionLog
    expect(m.exercises['7'].sets.map((s) => s.value)).toEqual([10, 9])
    expect(m.exercises['7'].sets.every((s) => s.done)).toBe(true)
  })

  it('a set changed on one device only keeps that change (fixed value, set un-ticked)', () => {
    const base = withSets('', [done(10)])
    const fixed = merge3('sessions', base, withSets('', [done(10), done(9)]), withSets('', [done(12)])) as unknown as SessionLog
    expect(fixed.exercises['7'].sets.map((s) => s.value)).toEqual([12, 9])
    const unticked = merge3('sessions', base, withSets('', [done(10), done(9)]), withSets('', [{ ...open, value: 10 }]))
    expect((unticked as unknown as SessionLog).exercises['7'].sets.map((s) => s.done)).toEqual([false, true])
  })

  it('per side: each side merged separately', () => {
    const side = (dx: number | null, sx: number | null): SetLog => ({
      done: dx != null && sx != null,
      value: null,
      dx: { done: dx != null, value: dx },
      sx: { done: sx != null, value: sx },
      at: null,
    })
    const base = withSets('', [])
    const m = merge3('sessions', base, withSets('', [side(8, null)]), withSets('', [side(null, 7)])) as unknown as SessionLog
    expect(m.exercises['7'].sets[0]).toMatchObject({ done: true, dx: { value: 8 }, sx: { value: 7 } })
  })

  it('notes written on both devices are kept together; the earliest start wins', () => {
    const base = rec(session())
    const local = rec(session('spalla ok', { startedAt: '2026-10-01T09:10:00.000Z' }))
    const remote = rec(session('caldo', { startedAt: '2026-10-01T09:00:00.000Z' }))
    const m = merge3('sessions', base, local, remote) as unknown as SessionLog
    expect(m.notes).toBe('spalla ok\ncaldo')
    expect(m.startedAt).toBe('2026-10-01T09:00:00.000Z')
  })

  it('a real collision on one field: the newer copy decides', () => {
    const base = rec({ date: DAY, weightKg: 70, sleepH: null, elbowNextMorning: null })
    const local = rec({ date: DAY, weightKg: 71, sleepH: null, elbowNextMorning: null, updatedAt: 10 })
    const remote = rec({ date: DAY, weightKg: 72, sleepH: 8, elbowNextMorning: null, updatedAt: 20 })
    expect(merge3('days', base, local, remote)).toMatchObject({ weightKg: 72, sleepH: 8, updatedAt: 21 })
  })

  it('an edit always beats a deletion', () => {
    const base = rec(session())
    const edited = withSets('', [done(10)])
    expect(merge3('sessions', base, edited, null)).toBe(edited)
    expect(merge3('sessions', base, null, edited)).toBe(edited)
    // Deleted on both: stays deleted.
    expect(merge3('sessions', base, null, null)).toBeNull()
  })

  it('without a common version (first sync) the two copies are united', () => {
    const local = withSets('iPhone', [done(10)])
    const remote = withSets('Mac', [open, done(9)], { rpe: 7 })
    const m = merge3('sessions', null, local, remote) as unknown as SessionLog
    expect(m.notes).toBe('iPhone\nMac')
    expect(m.exercises['7'].sets.map((s) => s.value)).toEqual([10, 9])
  })

  it('pins: the newer pin wins', () => {
    const a = { url: 'https://youtu.be/aaaaaaaaaaa', addedAt: 'x', updatedAt: 5 }
    const b = { url: 'https://youtu.be/bbbbbbbbbbb', addedAt: 'y', updatedAt: 6 }
    expect(merge3('pins', null, a, b)).toBe(b)
  })
})

describe('collectChanges', () => {
  it('the first sync with a file uploads every record; records saved before sync count as the oldest', () => {
    const d = data({ sessions: { [DAY]: session() }, days: { [DAY]: { date: DAY, weightKg: 73, elbowNextMorning: null, sleepH: null } } })
    const { records, count, uploadAll } = collectChanges(d)
    expect(uploadAll).toBe(true)
    expect(count).toBe(2)
    expect(records.sessions[DAY]).toMatchObject({ date: DAY, updatedAt: 1 })
    expect(records.days[DAY]).toMatchObject({ weightKg: 73, updatedAt: 1 })
  })

  it('then only the pending keys; a pending key without its record is a deletion', () => {
    const d = data(
      { sessions: { [DAY]: session('', { updatedAt: 50 }), '2026-10-02': session() } },
      { uploadAll: false, epoch: 'e', pending: { sessions: { [DAY]: 50, '2026-10-03': 70 }, days: {}, pins: {} } },
    )
    const { records, count, marks } = collectChanges(d)
    expect(count).toBe(2)
    expect(Object.keys(records.sessions).sort()).toEqual([DAY, '2026-10-03'])
    expect(records.sessions['2026-10-03']).toEqual({ deleted: true, updatedAt: 70 })
    expect(marks.sessions).toEqual({ [DAY]: 50, '2026-10-03': 70 })
  })
})

describe('noteSent', () => {
  it('keeps the first upload without a reply: with the same since, later ones can only conflict with it', () => {
    const d = data({ sessions: { [DAY]: session('primo') } }, { epoch: 'e', uploadAll: false, pending: { sessions: { [DAY]: 1 }, days: {}, pins: {}, } })
    const once = noteSent(d.sync, collectChanges(d))
    expect(once.sent.sessions[DAY]).toMatchObject({ notes: 'primo' })
    const later = { ...d, sessions: { [DAY]: session('secondo') }, sync: once }
    expect(noteSent(once, collectChanges(later)).sent.sessions[DAY]).toMatchObject({ notes: 'primo' })
    const deleted = { ...d, sessions: {}, sync: { ...d.sync, sent: { sessions: {}, days: {}, pins: {} } } }
    expect(noteSent(deleted.sync, collectChanges(deleted)).sent.sessions[DAY]).toBeNull()
  })
})

describe('applySyncResponse', () => {
  const ok = (patch: Partial<SyncOk> = {}): SyncOk => ({
    ok: true,
    epoch: 'e1',
    rev: 5,
    reset: false,
    accepted: { sessions: [], days: [], pins: [] },
    conflicts: { sessions: [], days: [], pins: [] },
    records: emptyRecords(),
    skipped: { sessions: [], days: [], pins: [] },
    ...patch,
  })
  const synced = (patch: Partial<AppData> = {}, sync: Partial<AppData['sync']> = {}) =>
    data(patch, { epoch: 'e1', rev: 4, uploadAll: false, ...sync })

  it('an accepted upload is done', () => {
    const d = synced({ sessions: { [DAY]: session('x') } }, {
      pending: { sessions: { [DAY]: 10 }, days: {}, pins: {} },
      base: { sessions: { [DAY]: null }, days: {}, pins: {} },
    })
    const { data: next, more } = applySyncResponse(d, collectChanges(d), ok({ accepted: { sessions: [DAY], days: [], pins: [] } }), NOW, 'b')
    expect(next.sync.pending.sessions).toEqual({})
    expect(next.sync.base.sessions).toEqual({})
    expect(next.sync).toMatchObject({ epoch: 'e1', rev: 5, lastError: null, lastSyncAt: new Date(NOW).toISOString() })
    expect(more).toBe(false)
  })

  it('changed again during the upload: stays to send, against the version now on Drive', () => {
    const d = synced({ sessions: { [DAY]: session('x') } }, { pending: { sessions: { [DAY]: 10 }, days: {}, pins: {} } })
    const sent = collectChanges(d)
    const later = { ...d, sessions: { [DAY]: session('xy') }, sync: { ...d.sync, pending: { ...d.sync.pending, sessions: { [DAY]: 11 } } } }
    const { data: next, more } = applySyncResponse(later, sent, ok({ accepted: { sessions: [DAY], days: [], pins: [] } }), NOW, 'b')
    expect(next.sync.pending.sessions).toEqual({ [DAY]: 11 })
    expect(next.sync.base.sessions[DAY]).toMatchObject({ notes: 'x' })
    expect(next.sessions[DAY].notes).toBe('xy')
    expect(more).toBe(true)
  })

  it('a conflict is merged with the version on Drive and sent again', () => {
    const base = session('', { exercises: { '7': log([]) } })
    const d = synced(
      { sessions: { [DAY]: session('', { exercises: { '7': log([done(10)]) } }) } },
      { pending: { sessions: { [DAY]: 10 }, days: {}, pins: {} }, base: { sessions: { [DAY]: base }, days: {}, pins: {} } },
    )
    const remote = session('buona', { exercises: { '7': log([open, done(9)]) }, updatedAt: 99 })
    const res = ok({
      conflicts: { sessions: [DAY], days: [], pins: [] },
      records: { ...emptyRecords(), sessions: { [DAY]: rec(remote) } },
    })
    const { data: next, more, received } = applySyncResponse(d, collectChanges(d), res, NOW, 'b')
    expect(next.sessions[DAY].notes).toBe('buona')
    expect(next.sessions[DAY].exercises['7'].sets.map((s) => s.value)).toEqual([10, 9])
    expect(next.sync.pending.sessions[DAY]).toBeGreaterThan(NOW)
    expect(next.sync.base.sessions[DAY]).toEqual(remote)
    expect(received).toBe(1)
    expect(more).toBe(true)
  })

  it('a conflict already contained in the version on Drive is simply adopted', () => {
    const d = synced(
      { sessions: { [DAY]: session('stessa') } },
      { pending: { sessions: { [DAY]: 10 }, days: {}, pins: {} }, base: { sessions: { [DAY]: session() }, days: {}, pins: {} } },
    )
    const res = ok({
      conflicts: { sessions: [DAY], days: [], pins: [] },
      records: { ...emptyRecords(), sessions: { [DAY]: rec(session('stessa', { updatedAt: 3 })) } },
    })
    const { data: next, more } = applySyncResponse(d, collectChanges(d), res, NOW, 'b')
    expect(next.sync.pending.sessions).toEqual({})
    expect(more).toBe(false)
  })

  it('records from other devices are adopted with their date; deletions remove them', () => {
    const d = synced({ pins: { old: { url: 'https://youtu.be/ooooooooooo', addedAt: 'x' } } })
    const res = ok({
      records: {
        sessions: { '2026-10-03': rec({ ...session('gambe'), date: 'sbagliata' }) },
        days: {},
        pins: { old: { deleted: true, updatedAt: 3 }, dip: { url: 'https://youtu.be/abcdefghijk', addedAt: 'x', updatedAt: 9 } },
      },
    })
    const { data: next, received } = applySyncResponse(d, collectChanges(d), res, NOW, 'b')
    expect(next.sessions['2026-10-03']).toMatchObject({ date: '2026-10-03', notes: 'gambe' })
    expect(Object.keys(next.pins)).toEqual(['dip'])
    expect(received).toBe(3)
  })

  it('a new file identity: every local record is merged with the file, none overwritten', () => {
    const d = synced({
      sessions: { [DAY]: session('solo qui'), '2026-10-02': session('uguale') },
    })
    const res = ok({
      epoch: 'e2',
      rev: 2,
      reset: true,
      records: { ...emptyRecords(), sessions: { '2026-10-02': rec(session('uguale', { updatedAt: 4 })) } },
    })
    const { data: next, more } = applySyncResponse(d, collectChanges(d), res, NOW, 'b')
    expect(next.sync.epoch).toBe('e2')
    expect(Object.keys(next.sync.pending.sessions)).toEqual([DAY])
    expect(next.sync.base.sessions[DAY]).toBeNull()
    expect(more).toBe(true)
  })

  it('remembers the records it could not read, and never uploads them, until they arrive readable', () => {
    const unread = { sessions: [DAY], days: [], pins: [] }
    const d = synced({ sessions: { [DAY]: session('qui') } }, { pending: { sessions: { [DAY]: 5 }, days: {}, pins: {} } })
    const first = applySyncResponse(d, collectChanges(d), ok({ skipped: unread }), NOW, 'build-1')
    expect(first.data.sync).toMatchObject({ unreadable: unread, unreadableBuild: 'build-1' })
    // Its local change waits for an updated app: not sent, no further round.
    expect(first.more).toBe(false)
    expect(collectChanges(first.data).records.sessions).toEqual({})
    // A later reply without it keeps it.
    const later = applySyncResponse(first.data, collectChanges(first.data), ok(), NOW, 'build-1')
    expect(later.data.sync.unreadable).toEqual(unread)
    // Readable at last (updated app): merged and sent again.
    const readable = ok({ records: { ...emptyRecords(), sessions: { [DAY]: rec(session('Drive', { updatedAt: 4 })) } } })
    const fixed = applySyncResponse(later.data, collectChanges(later.data), readable, NOW, 'build-2')
    expect(fixed.data.sync).toMatchObject({ unreadable: { sessions: [], days: [], pins: [] }, unreadableBuild: null })
    expect(fixed.data.sessions[DAY].notes).toBe('qui\nDrive')
    expect(fixed.more).toBe(true)
  })

  it('recognises its own upload whose reply was lost: later local changes are not merged away', () => {
    const base = session('', { exercises: { '7': log([]) } })
    const ticked = session('', { exercises: { '7': log([done(10)]) }, updatedAt: 20 })
    // The tick was uploaded, Drive saved it, the reply never arrived; then the tick was undone.
    const d = synced(
      { sessions: { [DAY]: session('', { exercises: { '7': log([{ ...open, value: 10 }]) } }) } },
      {
        pending: { sessions: { [DAY]: 30 }, days: {}, pins: {} },
        base: { sessions: { [DAY]: base }, days: {}, pins: {} },
        sent: { sessions: { [DAY]: ticked }, days: {}, pins: {} },
      },
    )
    const res = ok({
      conflicts: { sessions: [DAY], days: [], pins: [] },
      records: { ...emptyRecords(), sessions: { [DAY]: rec(ticked) } },
    })
    const { data: next } = applySyncResponse(d, collectChanges(d), res, NOW, 'b')
    expect(next.sessions[DAY].exercises['7'].sets[0].done).toBe(false)
    expect(next.sync.base.sessions[DAY]).toEqual(ticked)
    expect(next.sync.sent.sessions).toEqual({})
  })

  it('puts downloaded sessions in local terms before comparing and merging', () => {
    const d = synced({ sessions: { [DAY]: session('qui') } }, { pending: { sessions: { [DAY]: 5 }, days: {}, pins: {} } })
    const res = ok({
      conflicts: { sessions: [DAY], days: [], pins: [] },
      records: { ...emptyRecords(), sessions: { [DAY]: rec(session('qui', { dayTitle: 'altra numerazione' })) } },
    })
    const align = (_kind: string, _key: string, r: Rec) => ({ ...r, dayTitle: null })
    const { data: next, more } = applySyncResponse(d, collectChanges(d), res, NOW, 'b', align)
    expect(next.sync.pending.sessions).toEqual({})
    expect(more).toBe(false)
  })

  it('never steps back to an older revision of the same file (another tab synced further)', () => {
    const d = synced({}, { rev: 9 })
    expect(applySyncResponse(d, collectChanges(d), ok({ rev: 7 }), NOW, 'b').data.sync.rev).toBe(9)
    // A file restored to an older version: its revision is the one to follow.
    expect(applySyncResponse(d, collectChanges(d), ok({ rev: 7, reset: true }), NOW, 'b').data.sync.rev).toBe(7)
  })
})

describe('postSync', () => {
  const reply = (body: unknown, status = 200) =>
    (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch
  const okBody = { ok: true, epoch: 'e1', rev: 3, reset: false, accepted: { days: ['2026-10-01'] }, conflicts: {}, records: {} }
  const call = (fetchImpl: typeof fetch) => postSync(EXEC, 'tok', { epoch: 'e1', since: 0, changes: emptyRecords() }, { fetchImpl })

  it('POSTs the changes as a plain body (no headers: no CORS preflight)', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response(JSON.stringify(okBody))
    }) as unknown as typeof fetch
    const changes = { ...emptyRecords(), days: { [DAY]: { date: DAY, weightKg: 73, updatedAt: 5 } } }
    const res = await postSync(EXEC, 'tok', { epoch: 'e1', since: 2, changes }, { fetchImpl })
    expect(res).toMatchObject({ ok: true, epoch: 'e1', rev: 3, reset: false })
    if (!res.ok) throw new Error(res.error)
    expect(res.accepted).toEqual({ sessions: [], days: [DAY], pins: [] })
    expect(seen!.url).toBe(`${EXEC}?token=tok`)
    expect(seen!.init.method).toBe('POST')
    expect(seen!.init.headers).toBeUndefined()
    expect(seen!.init.keepalive).toBeUndefined()
    expect(JSON.parse(String(seen!.init.body))).toEqual({ action: 'sync', v: 2, epoch: 'e1', since: 2, changes })
  })

  it('keepalive only for bodies browsers accept (64 KB)', async () => {
    const seen: (boolean | undefined)[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init.keepalive)
      return new Response(JSON.stringify(okBody))
    }) as unknown as typeof fetch
    const big = { ...emptyRecords(), sessions: { [DAY]: rec(session('x'.repeat(70_000))) } }
    await postSync(EXEC, 'tok', { epoch: 'e1', since: 0, changes: emptyRecords() }, { fetchImpl, keepalive: true })
    await postSync(EXEC, 'tok', { epoch: 'e1', since: 0, changes: big }, { fetchImpl, keepalive: true })
    expect(seen).toEqual([true, undefined])
  })

  it('keeps valid records, returns the keys it cannot read, ignores keys the app never uses', async () => {
    const res = await call(
      reply({
        ...okBody,
        reset: true,
        records: {
          sessions: { [DAY]: session(), 'non-una-data': session(), '2026-10-02': { deleted: true, updatedAt: 3 } },
          days: { [DAY]: 'rotto' },
          pins: { dip: { url: 'https://youtu.be/abcdefghijk', addedAt: 'x', updatedAt: 2 } },
        },
      }),
    )
    if (!res.ok) throw new Error(res.error)
    expect(res.reset).toBe(true)
    expect(Object.keys(res.records.sessions).sort()).toEqual([DAY, '2026-10-02'])
    expect(res.records.days).toEqual({})
    expect(Object.keys(res.records.pins)).toEqual(['dip'])
    expect(res.skipped).toEqual({ sessions: [], days: [DAY], pins: [] })
  })

  it('tells temporary problems (retried quietly) from the ones to fix', async () => {
    const kinds = async (fetchImpl: typeof fetch) => {
      const r = await call(fetchImpl)
      return r.ok ? 'ok' : r.kind
    }
    // Script without doPost, or an old one answering with the plan: update it.
    expect(await kinds(reply('<html>Funzione script non trovata: doPost</html>'))).toBe('outdated')
    expect(await kinds(reply(fixture))).toBe('outdated')
    expect(await kinds(reply({ ok: true, rev: 3, records: {} }))).toBe('outdated')
    expect(await kinds(reply({ error: 'unauthorized' }))).toBe('unauthorized')
    expect(await kinds(reply({ error: 'no_write_permission' }))).toBe('permission')
    expect(await kinds(reply({ error: 'data_corrupt' }))).toBe('corrupt')
    expect(await kinds(reply('x', 404))).toBe('http')
    for (const kind of ['outdated', 'unauthorized', 'permission', 'corrupt', 'http'] as const) expect(isTemporary(kind)).toBe(false)

    expect(await kinds(reply({ error: 'busy' }))).toBe('busy')
    expect(await kinds(reply({ error: 'internal', message: 'Service error: Drive' }))).toBe('unavailable')
    expect(await kinds(reply('x', 500))).toBe('unavailable')
    expect(await kinds(reply('x', 429))).toBe('unavailable')
    expect(await kinds(reply('<html>Google Drive non disponibile</html>'))).toBe('unavailable')
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await kinds(offline)).toBe('network')
    for (const kind of ['busy', 'unavailable', 'network'] as const) expect(isTemporary(kind)).toBe(true)
  })

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers()
    try {
      const hanging = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })) as unknown as typeof fetch
      const pending = call(hanging)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await pending).toMatchObject({ ok: false, kind: 'network' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('user changes are marked for the next upload', () => {
  beforeEach(() => {
    __setStateForTests(data({}, { epoch: 'e1', rev: 3, uploadAll: false }))
  })
  afterEach(() => {
    __setStateForTests(defaultData())
  })

  it('stamps sessions, diary and pins and marks their keys', () => {
    updateSet(DAY, 7, 0, { done: true, value: 7 })
    updateDayLog(DAY, { weightKg: 72.5 })
    setPin('dip', 'https://youtu.be/abcdefghijk')
    const s = getState()
    expect(s.sessions[DAY].updatedAt).toBeGreaterThan(1)
    expect(s.days[DAY].updatedAt).toBeGreaterThan(1)
    expect(s.pins.dip.updatedAt).toBeGreaterThan(1)
    expect(Object.keys(s.sync.pending.sessions)).toEqual([DAY])
    expect(Object.keys(s.sync.pending.days)).toEqual([DAY])
    expect(Object.keys(s.sync.pending.pins)).toEqual(['dip'])
    expect(collectChanges(s).count).toBe(3)
  })

  it('keeps the version before the first unsaved change as the common base', () => {
    __setStateForTests({ ...getState(), sessions: { [DAY]: session('su Drive') } })
    updateSessionMeta(DAY, { notes: 'prima modifica' })
    const first = getState().sync.pending.sessions[DAY]
    updateSessionMeta(DAY, { notes: 'seconda modifica' })
    const s = getState()
    expect(s.sync.base.sessions[DAY]).toMatchObject({ notes: 'su Drive' })
    expect(s.sync.pending.sessions[DAY]).toBeGreaterThan(first)
  })

  it('deletions become tombstones', () => {
    startSession(DAY)
    setPin('dip', 'https://youtu.be/abcdefghijk')
    deleteSession(DAY)
    setPin('dip', null)
    const { records } = collectChanges(getState())
    expect(records.sessions[DAY]).toMatchObject({ deleted: true })
    expect(records.pins.dip).toMatchObject({ deleted: true })
  })

  it('"Cancella ovunque" deletes every log as a change to send; plan and link stay', () => {
    updateSet(DAY, 7, 0, { done: true, value: 7 })
    updateDayLog('2026-10-02', { sleepH: 7 })
    deleteAllLogs()
    const s = getState()
    expect(s.sessions).toEqual({})
    expect(s.days).toEqual({})
    expect(s.plan).not.toBeNull()
    const { records } = collectChanges(s)
    expect(records.sessions[DAY]).toMatchObject({ deleted: true })
    expect(records.days['2026-10-02']).toMatchObject({ deleted: true })
  })

  it('a backup import with saving on replaces the data on Drive too', () => {
    __setStateForTests({ ...getState(), sessions: { [DAY]: session('vecchia') }, days: { [DAY]: { date: DAY, weightKg: 70, elbowNextMorning: null, sleepH: null } } })
    const generation = getState().sync.generation
    replaceAllData({ ...getState(), sessions: { [DAY]: session('dal backup') }, days: {}, sync: defaultSync() })
    const s = getState()
    expect(s.sync.generation).toBe(generation + 1)
    expect(s.sync.epoch).toBe('e1')
    const { records } = collectChanges(s)
    expect(records.sessions[DAY]).toMatchObject({ notes: 'dal backup' })
    expect(records.days[DAY]).toMatchObject({ deleted: true })
    expect(s.sync.base.sessions[DAY]).toMatchObject({ notes: 'vecchia' })
  })

  it('with saving off, an import is still a change to send later; "Cancella" starts over with Drive', () => {
    __setStateForTests({ ...getState(), sync: { ...getState().sync, enabled: false } })
    replaceAllData({ ...defaultData(), sessions: { [DAY]: session() } })
    expect(getState().sync).toMatchObject({ enabled: false, epoch: 'e1', rev: 3, generation: 1 })
    expect(Object.keys(getState().sync.pending.sessions)).toEqual([DAY])
    clearAllData(true)
    expect(getState().sync).toMatchObject({ enabled: false, epoch: null, rev: 0, uploadAll: true, generation: 2 })
  })

  it('a new link only drops the replies of the old one: pending changes and the file identity stay', () => {
    updateSessionMeta(DAY, { notes: 'da salvare' })
    updateSettings({ endpoint: EXEC })
    expect(getState().sync).toMatchObject({ epoch: 'e1', generation: 0 })
    updateSettings({ endpoint: 'https://script.google.com/macros/s/NUOVO-DEPLOYMENT/exec' })
    expect(getState().sync).toMatchObject({ epoch: 'e1', rev: 3, uploadAll: false, generation: 1 })
    expect(Object.keys(getState().sync.pending.sessions)).toEqual([DAY])
  })
})
