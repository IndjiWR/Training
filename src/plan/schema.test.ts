import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from './schema'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('parsePlan (schema 1)', () => {
  it('accepts the real plan scheda-corrente.json', () => {
    const r = parsePlan(fixture)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.id).toBe('2026-10-01')
    expect(r.plan.days).toHaveLength(4)
    expect(r.plan.days.map((d) => d.type)).toEqual(['SPINTA', 'TIRATA', 'GAMBE', 'RIPOSO'])
    expect(r.plan.library['front-lever'].on_yellow).toBe('halve')
    expect(r.plan.elbow?.green_max).toBe(3)
    expect(r.plan.warmups['riscaldamento-tirata'].items.length).toBeGreaterThan(0)
  })

  it('keeps nulls of the fixture as null', () => {
    const r = parsePlan(fixture)
    if (!r.ok) throw new Error(r.error)
    const info = r.plan.days[3].exercises[0]
    expect(info.kind).toBe('info')
    expect(info.sets).toBeNull()
    expect(info.unit).toBeNull()
    expect(info.rest_s).toBeNull()
    expect(r.plan.library['riscaldamento-tirata'].video_query).toBeNull()
  })

  it('normalises missing optional fields (null / false / [])', () => {
    const p = clone(fixture) as Record<string, unknown> & { days: Record<string, unknown>[] }
    const ex = (p.days[0].exercises as Record<string, unknown>[])[0]
    delete ex.note
    delete ex.per_side
    delete ex.test
    delete p.tests
    delete p.warmups
    const r = parsePlan(p)
    if (!r.ok) throw new Error(r.error)
    expect(r.plan.days[0].exercises[0].note).toBeNull()
    expect(r.plan.days[0].exercises[0].per_side).toBe(false)
    expect(r.plan.days[0].exercises[0].test).toBe(false)
    expect(r.plan.tests).toEqual([])
    expect(r.plan.warmups).toEqual({})
  })

  it('rejects an unknown kind with a readable Italian error and path', () => {
    const p = clone(fixture) as { days: { exercises: { kind: string }[] }[] }
    p.days[1].exercises[3].kind = 'sprint'
    const r = parsePlan(p)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('days[1].exercises[3].kind')
    expect(r.error).toMatch(/formato atteso/)
  })

  it('rejects a wrong schema version and a bad date', () => {
    const p = clone(fixture) as { schema: number; days: { date: string }[] }
    p.schema = 2
    p.days[0].date = '01/10/2026'
    const r = parsePlan(p)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('schema')
    expect(r.error).toContain('days[0].date')
  })

  it('reports the Apps Script error payload', () => {
    const r = parsePlan({ error: 'unauthorized' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('unauthorized')
  })

  it('rejects non-objects', () => {
    expect(parsePlan(null).ok).toBe(false)
    expect(parsePlan('ciao').ok).toBe(false)
    expect(parsePlan([]).ok).toBe(false)
  })
})
