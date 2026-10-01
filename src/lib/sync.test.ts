import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan, type Plan } from '../plan/schema'
import { buildPlanUrl, fetchPlan, FETCH_TIMEOUT_MS, isNewerPlan, readPlanFile, stripTokenParam } from './sync'

const ENDPOINT = 'https://script.google.com/macros/s/ABC123/exec'
const TOKEN = 'secret-token'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function fixturePlan(): Plan {
  const r = parsePlan(fixture)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

function planWith(patch: Partial<Plan>): Plan {
  return { ...fixturePlan(), ...patch }
}

type Call = { url: string; init: RequestInit | undefined }

/** fetch double returning `body` with `status`, recording every call. */
function mockFetch(body: string, status = 200) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { impl, calls }
}

describe('buildPlanUrl', () => {
  it('appends ?token= to an endpoint without query', () => {
    expect(buildPlanUrl(ENDPOINT, TOKEN)).toBe(`${ENDPOINT}?token=secret-token`)
  })

  it('appends &token= keeping an existing query and drops the hash', () => {
    expect(buildPlanUrl(`${ENDPOINT}?v=2&x=a%20b#frag`, TOKEN)).toBe(`${ENDPOINT}?v=2&x=a%20b&token=secret-token`)
  })

  it('replaces a token already present in the endpoint', () => {
    expect(buildPlanUrl(`${ENDPOINT}?token=old&v=1`, 'new')).toBe(`${ENDPOINT}?v=1&token=new`)
  })

  it('encodes the token and trims whitespace', () => {
    const url = buildPlanUrl(`  ${ENDPOINT}  `, ' a b&c/d+e=f?ü ')
    expect(url).toBe(`${ENDPOINT}?token=a%20b%26c%2Fd%2Be%3Df%3F%C3%BC`)
    expect(new URL(url).searchParams.get('token')).toBe('a b&c/d+e=f?ü')
  })

  it('allows http only for local development hosts', () => {
    expect(buildPlanUrl('http://localhost:8787/plan', 't')).toBe('http://localhost:8787/plan?token=t')
    expect(buildPlanUrl('http://127.0.0.1/plan', 't')).toBe('http://127.0.0.1/plan?token=t')
    expect(() => buildPlanUrl('http://example.com/exec', 't')).toThrow(/https/)
  })

  it('rejects invalid URLs and the /dev test URL', () => {
    expect(() => buildPlanUrl('', 't')).toThrow(/Manca/)
    expect(() => buildPlanUrl('script.google.com/macros/s/X/exec', 't')).toThrow(/non è valido/)
    expect(() => buildPlanUrl('ftp://example.com/x', 't')).toThrow(/https/)
    expect(() => buildPlanUrl('https://script.google.com/macros/s/X/dev', 't')).toThrow(/\/exec/)
  })
})

describe('stripTokenParam', () => {
  it('removes a token pasted inside the endpoint, keeping the rest of the query', () => {
    expect(stripTokenParam(`${ENDPOINT}?token=leaked`)).toBe(ENDPOINT)
    expect(stripTokenParam(` ${ENDPOINT}?v=2&token=a&token&x=a%20b#f `)).toBe(`${ENDPOINT}?v=2&x=a%20b#f`)
    expect(stripTokenParam(`${ENDPOINT}?token=leaked`)).not.toContain('leaked')
  })

  it('leaves anything without a token parameter as typed (trimmed)', () => {
    expect(stripTokenParam(`  ${ENDPOINT}  `)).toBe(ENDPOINT)
    expect(stripTokenParam(`${ENDPOINT}?v=2&tokens=1&mytoken=2`)).toBe(`${ENDPOINT}?v=2&tokens=1&mytoken=2`)
    expect(stripTokenParam('script.google.com/macros/s/X/exec?token=a')).toBe('script.google.com/macros/s/X/exec?token=a')
    expect(stripTokenParam('')).toBe('')
  })
})

describe('fetchPlan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns the validated plan of the real fixture', async () => {
    const { impl, calls } = mockFetch(JSON.stringify(fixture))
    const r = await fetchPlan(ENDPOINT, TOKEN, impl)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.id).toBe('2026-10-01')
    expect(r.plan.days).toHaveLength(4)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ENDPOINT}?token=secret-token`)
  })

  it('sends a plain GET: no headers, no body, no credentials (no CORS preflight)', async () => {
    const { impl, calls } = mockFetch(JSON.stringify(fixture))
    await fetchPlan(ENDPOINT, TOKEN, impl)
    const init = calls[0].init
    expect(init).toBeDefined()
    expect(init).not.toHaveProperty('headers')
    expect(init).not.toHaveProperty('body')
    expect(init).toEqual({ method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit' })
  })

  it('accepts a body starting with a UTF-8 BOM', async () => {
    const { impl } = mockFetch(`﻿${JSON.stringify(fixture)}`)
    const r = await fetchPlan(ENDPOINT, TOKEN, impl)
    expect(r.ok).toBe(true)
  })

  it('maps {"error":"unauthorized"} to kind unauthorized', async () => {
    const { impl } = mockFetch('{"error":"unauthorized"}')
    const r = await fetchPlan(ENDPOINT, 'wrong', impl)
    expect(r).toMatchObject({ ok: false, kind: 'unauthorized' })
    if (!r.ok) expect(r.error).toMatch(/Token non valido/)
  })

  it('maps {"error":"not_found"} to a message about the file name pattern', async () => {
    const { impl } = mockFetch('{"error":"not_found"}')
    const r = await fetchPlan(ENDPOINT, TOKEN, impl)
    expect(r).toMatchObject({ ok: false, kind: 'http' })
    if (!r.ok) expect(r.error).toMatch(/scheda-AAAA-MM-GG\.json/)
  })

  it('maps the other script errors', async () => {
    const notConfigured = await fetchPlan(ENDPOINT, TOKEN, mockFetch('{"error":"not_configured"}').impl)
    expect(notConfigured).toMatchObject({ ok: false, kind: 'http' })
    if (!notConfigured.ok) expect(notConfigured.error).toMatch(/FOLDER_ID/)

    const badFile = await fetchPlan(
      ENDPOINT,
      TOKEN,
      mockFetch('{"error":"invalid_json","file":"scheda-2026-10-04.json"}').impl,
    )
    expect(badFile).toMatchObject({ ok: false, kind: 'invalid' })
    if (!badFile.ok) expect(badFile.error).toMatch(/scheda-2026-10-04\.json/)

    const internal = await fetchPlan(ENDPOINT, TOKEN, mockFetch('{"error":"internal","message":"boom"}').impl)
    expect(internal).toMatchObject({ ok: false, kind: 'http' })
    if (!internal.ok) expect(internal.error).toMatch(/boom/)

    const unknown = await fetchPlan(ENDPOINT, TOKEN, mockFetch('{"error":"quota"}').impl)
    expect(unknown).toMatchObject({ ok: false, kind: 'http' })
    if (!unknown.ok) expect(unknown.error).toMatch(/quota/)
  })

  it('explains an HTML answer (Google login page) as a deploy access problem', async () => {
    const html = '<!DOCTYPE html><html><head><title>Accedi - Account Google</title></head><body></body></html>'
    const r = await fetchPlan(ENDPOINT, TOKEN, mockFetch(html).impl)
    expect(r).toMatchObject({ ok: false, kind: 'invalid' })
    if (!r.ok) {
      expect(r.error).toMatch(/Chiunque/)
      expect(r.error).toMatch(/\/exec/)
    }
  })

  it('explains a missing doGet', async () => {
    const html = '<html><body>Script function not found: doGet</body></html>'
    const r = await fetchPlan(ENDPOINT, TOKEN, mockFetch(html).impl)
    expect(r).toMatchObject({ ok: false, kind: 'invalid' })
    if (!r.ok) expect(r.error).toMatch(/doGet/)
  })

  it('maps a fetch TypeError to kind network', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    const r = await fetchPlan(ENDPOINT, TOKEN, impl)
    expect(r).toMatchObject({ ok: false, kind: 'network' })
    if (!r.ok) {
      expect(r.error).toMatch(/connessione/)
      expect(r.error).toMatch(/\/exec/)
    }
  })

  it('maps non-2xx statuses to kind http with the status', async () => {
    const r500 = await fetchPlan(ENDPOINT, TOKEN, mockFetch('oops', 500).impl)
    expect(r500).toMatchObject({ ok: false, kind: 'http' })
    if (!r500.ok) expect(r500.error).toMatch(/HTTP 500/)

    const r404 = await fetchPlan(ENDPOINT, TOKEN, mockFetch('', 404).impl)
    expect(r404).toMatchObject({ ok: false, kind: 'http' })
    if (!r404.ok) expect(r404.error).toMatch(/HTTP 404/)

    const r403 = await fetchPlan(ENDPOINT, TOKEN, mockFetch('', 403).impl)
    if (!r403.ok) expect(r403.error).toMatch(/Chiunque/)
  })

  it('keeps the readable zod message for an invalid plan (bad kind)', async () => {
    const bad = clone(fixture) as { days: { exercises: { kind: string }[] }[] }
    bad.days[1].exercises[3].kind = 'sprint'
    const r = await fetchPlan(ENDPOINT, TOKEN, mockFetch(JSON.stringify(bad)).impl)
    expect(r).toMatchObject({ ok: false, kind: 'invalid' })
    if (!r.ok) {
      expect(r.error).toMatch(/schema 1/)
      expect(r.error).toContain('days[1].exercises[3].kind')
    }
  })

  it('rejects a JSON body that is not a plan', async () => {
    const r = await fetchPlan(ENDPOINT, TOKEN, mockFetch('[1,2,3]').impl)
    expect(r).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('returns config errors without calling fetch', async () => {
    const { impl, calls } = mockFetch(JSON.stringify(fixture))
    expect(await fetchPlan('', TOKEN, impl)).toMatchObject({ ok: false, kind: 'config' })
    expect(await fetchPlan(ENDPOINT, '  ', impl)).toMatchObject({ ok: false, kind: 'config' })
    expect(await fetchPlan('', '', impl)).toMatchObject({ ok: false, kind: 'config' })
    expect(await fetchPlan('not a url', TOKEN, impl)).toMatchObject({ ok: false, kind: 'config' })
    expect(await fetchPlan('http://example.com/exec', TOKEN, impl)).toMatchObject({ ok: false, kind: 'config' })
    expect(calls).toHaveLength(0)
  })

  it('returns offline without calling fetch when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { impl, calls } = mockFetch(JSON.stringify(fixture))
    const r = await fetchPlan(ENDPOINT, TOKEN, impl)
    expect(r).toMatchObject({ ok: false, kind: 'offline' })
    expect(calls).toHaveLength(0)
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    const impl = (() => new Promise<Response>(() => {})) as typeof fetch
    const pending = fetchPlan(ENDPOINT, TOKEN, impl)
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1)
    expect(await pending).toMatchObject({ ok: false, kind: 'network' })
  })
})

describe('isNewerPlan', () => {
  const current = planWith({ id: 'a', generated_at: '2026-10-01T17:33+02:00' })

  it('accepts any plan when there is no current one', () => {
    expect(isNewerPlan(current, null)).toBe(true)
  })

  it('compares generated_at as instants', () => {
    expect(isNewerPlan(planWith({ generated_at: '2026-10-04T09:00+02:00' }), current)).toBe(true)
    expect(isNewerPlan(planWith({ generated_at: '2026-09-27T09:00+02:00' }), current)).toBe(false)
    // Same instant written with another offset is not newer.
    expect(isNewerPlan(planWith({ generated_at: '2026-10-01T15:33Z' }), current)).toBe(false)
    // Later instant even if the string sorts lower.
    expect(isNewerPlan(planWith({ generated_at: '2026-10-01T16:00Z' }), current)).toBe(true)
  })

  it('does not treat the same generated_at with another id as newer', () => {
    expect(isNewerPlan(planWith({ id: 'b', generated_at: current.generated_at }), current)).toBe(false)
  })

  it('falls back to string comparison when a date is unparsable', () => {
    const odd = planWith({ generated_at: 'settimana-2' })
    expect(isNewerPlan(planWith({ generated_at: 'settimana-3' }), odd)).toBe(true)
    expect(isNewerPlan(planWith({ generated_at: 'settimana-1' }), odd)).toBe(false)
  })
})

describe('readPlanFile', () => {
  it('reads and validates the real plan', async () => {
    const file = new File([JSON.stringify(fixture)], 'scheda-2026-10-01.json', { type: 'application/json' })
    const r = await readPlanFile(file)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.id).toBe('2026-10-01')
  })

  it('accepts a file with a BOM', async () => {
    const file = new File([`﻿${JSON.stringify(fixture)}`], 'scheda.json')
    expect((await readPlanFile(file)).ok).toBe(true)
  })

  it('explains a file that is not JSON', async () => {
    const r = await readPlanFile(new File(['{ non json'], 'appunti.txt'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/appunti\.txt/)
      expect(r.error).toMatch(/non è un JSON valido/)
    }
  })

  it('returns the parsePlan message for a JSON that is not a plan', async () => {
    const bad = clone(fixture) as { days: unknown[] }
    bad.days = []
    const r = await readPlanFile(new File([JSON.stringify(bad)], 'scheda.json'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non contiene giorni/)
  })
})
