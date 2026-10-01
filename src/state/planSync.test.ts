import { describe, expect, it } from 'vitest'
import type { SessionLog } from './types'
import { ACTIVE_SESSION_MS, openSessionStart } from './planSync'

function session(date: string, patch: Partial<SessionLog> = {}): SessionLog {
  return {
    date,
    planId: 'p',
    dayType: 'SPINTA',
    dayTitle: null,
    startedAt: null,
    finishedAt: null,
    elbowPre: null,
    elbowOverride: null,
    rpe: null,
    elbowDuring: null,
    notes: '',
    skipped: false,
    exercises: {},
    ...patch,
  }
}

describe('openSessionStart', () => {
  it('is null without an open session', () => {
    expect(openSessionStart({})).toBeNull()
    expect(
      openSessionStart({
        '2026-09-29': session('2026-09-29'),
        '2026-09-30': session('2026-09-30', {
          startedAt: '2026-09-30T16:00:00.000Z',
          finishedAt: '2026-09-30T17:00:00.000Z',
        }),
        '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z', skipped: true }),
        '2026-10-02': session('2026-10-02', { startedAt: 'non una data' }),
      }),
    ).toBeNull()
  })

  it('returns the latest start among started, unfinished, not skipped sessions', () => {
    const sessions = {
      '2026-09-24': session('2026-09-24', { startedAt: '2026-09-24T16:00:00.000Z' }),
      '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z' }),
      '2026-10-02': session('2026-10-02', { startedAt: '2026-10-02T16:00:00.000Z', skipped: true }),
    }
    expect(openSessionStart(sessions)).toBe(Date.parse('2026-10-01T16:00:00.000Z'))
  })

  it('pairs with ACTIVE_SESSION_MS: a forgotten session stops counting after 3 h', () => {
    const start = openSessionStart({ '2026-10-01': session('2026-10-01', { startedAt: '2026-10-01T16:00:00.000Z' }) })
    expect(start).not.toBeNull()
    expect(ACTIVE_SESSION_MS).toBe(3 * 60 * 60_000)
    const inProgress = (now: number) => start != null && now - start < ACTIVE_SESSION_MS
    expect(inProgress(Date.parse('2026-10-01T18:59:59.000Z'))).toBe(true)
    expect(inProgress(Date.parse('2026-10-01T19:00:00.000Z'))).toBe(false)
  })
})
