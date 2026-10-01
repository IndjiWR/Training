import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import type { Day, Exercise, Library, Plan } from '../plan/schema'
import {
  applyElbow,
  CHECK_KEY,
  dayHasElbowCheck,
  DEFAULT_ELBOW,
  elbowLevel,
  isOptional,
  levelEmoji,
  levelLabel,
  libraryEntry,
  plannedSetCount,
  rulesText,
  sessionElbowLevel,
  stopRule,
} from './elbow'
import type { EffectiveExercise } from './elbow'

function loadPlan(): Plan {
  const r = parsePlan(fixture)
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

const plan = loadPlan()
const dayOf = (date: string): Day => {
  const d = plan.days.find((x) => x.date === date)
  if (!d) throw new Error(`missing day ${date}`)
  return d
}
const TIRATA = dayOf('2026-10-02')

/** Synthetic exercise based on a real one of the fixture. */
function mkEx(patch: Partial<Exercise>): Exercise {
  return { ...TIRATA.exercises[6], test: false, home: false, ...patch }
}

const byKeyKind = (effs: EffectiveExercise[], key: string, kind: Exercise['kind']) => {
  const e = effs.find((x) => x.ex.key === key && x.ex.kind === kind)
  if (!e) throw new Error(`missing ${key}/${kind}`)
  return e
}

/** Effective exercise equal to the plan (no transform). */
const unchanged = (e: EffectiveExercise, ex: Exercise) =>
  expect(e).toMatchObject({ ex, hidden: false, hiddenReason: null, sets: ex.sets, setsMax: ex.sets_max, halved: false })

describe('elbowLevel', () => {
  const elbow = plan.elbow

  it('uses the fixture thresholds (green_max 3, yellow_max 5)', () => {
    expect(elbow?.green_max).toBe(3)
    expect(elbow?.yellow_max).toBe(5)
    expect(elbowLevel(0, elbow)).toBe('green')
    expect(elbowLevel(3, elbow)).toBe('green')
    expect(elbowLevel(4, elbow)).toBe('yellow')
    expect(elbowLevel(5, elbow)).toBe('yellow')
    expect(elbowLevel(6, elbow)).toBe('red')
    expect(elbowLevel(10, elbow)).toBe('red')
  })

  it('treats non-integer scores by the same inequalities', () => {
    expect(elbowLevel(3.5, elbow)).toBe('yellow')
    expect(elbowLevel(5.5, elbow)).toBe('red')
  })

  it('falls back to DEFAULT_ELBOW when the plan has no elbow block', () => {
    expect(DEFAULT_ELBOW).toMatchObject({ green_max: 3, yellow_max: 5 })
    expect(elbowLevel(3, null)).toBe('green')
    expect(elbowLevel(4, null)).toBe('yellow')
    expect(elbowLevel(6, null)).toBe('red')
  })

  it('follows custom thresholds', () => {
    const strict = { ...DEFAULT_ELBOW, green_max: 1, yellow_max: 2 }
    expect(elbowLevel(1, strict)).toBe('green')
    expect(elbowLevel(2, strict)).toBe('yellow')
    expect(elbowLevel(3, strict)).toBe('red')
  })
})

describe('dayHasElbowCheck', () => {
  it('is true only for the TIRATA day of the fixture', () => {
    expect(CHECK_KEY).toBe('check-gomito')
    const withCheck = plan.days.filter(dayHasElbowCheck).map((d) => d.date)
    expect(withCheck).toEqual(['2026-10-02'])
  })
})

describe('sessionElbowLevel', () => {
  it('lets the manual override win over the score', () => {
    expect(sessionElbowLevel({ elbowPre: 2, elbowOverride: 'red' }, plan.elbow)).toBe('red')
    expect(sessionElbowLevel({ elbowPre: 8, elbowOverride: 'green' }, plan.elbow)).toBe('green')
    expect(sessionElbowLevel({ elbowPre: null, elbowOverride: 'yellow' }, plan.elbow)).toBe('yellow')
  })

  it('uses the score when there is no override', () => {
    expect(sessionElbowLevel({ elbowPre: 0, elbowOverride: null }, plan.elbow)).toBe('green')
    expect(sessionElbowLevel({ elbowPre: 4, elbowOverride: null }, plan.elbow)).toBe('yellow')
    expect(sessionElbowLevel({ elbowPre: 7, elbowOverride: null }, null)).toBe('red')
  })

  it('is null without score and override, or without session', () => {
    expect(sessionElbowLevel({ elbowPre: null, elbowOverride: null }, plan.elbow)).toBeNull()
    expect(sessionElbowLevel(null, plan.elbow)).toBeNull()
    expect(sessionElbowLevel(undefined, plan.elbow)).toBeNull()
  })
})

describe('applyElbow on the fixture TIRATA day (2026-10-02)', () => {
  const lib = plan.library

  it('keeps every exercise, in order, with its index', () => {
    for (const level of [null, 'green', 'yellow', 'red'] as const) {
      const effs = applyElbow(TIRATA, lib, level)
      expect(effs).toHaveLength(TIRATA.exercises.length)
      effs.forEach((e, i) => {
        expect(e.index).toBe(i)
        expect(e.ex).toBe(TIRATA.exercises[i])
        expect(e.lib).toBe(lib[TIRATA.exercises[i].key] ?? null)
      })
    }
  })

  it('changes nothing with no level or green', () => {
    for (const level of [null, 'green'] as const) {
      const effs = applyElbow(TIRATA, lib, level)
      effs.forEach((e, i) => unchanged(e, TIRATA.exercises[i]))
    }
  })

  it('yellow: skips muscle-up, halves front lever, leaves the rest', () => {
    const effs = applyElbow(TIRATA, lib, 'yellow')

    const mu = byKeyKind(effs, 'muscle-up', 'reps')
    expect(mu).toMatchObject({ hidden: true, hiddenReason: 'yellow-skip', halved: false })

    const flAttempts = byKeyKind(effs, 'front-lever', 'attempts')
    expect(flAttempts.ex.sets).toBe(3)
    expect(flAttempts.ex.sets_max).toBe(4)
    expect(flAttempts).toMatchObject({ hidden: false, hiddenReason: null, sets: 2, setsMax: 2, halved: true })

    const flHold = byKeyKind(effs, 'front-lever', 'hold')
    expect(flHold).toMatchObject({ hidden: false, sets: 2, setsMax: 2, halved: true })

    for (const key of ['check-gomito', 'isometria-polso', 'riscaldamento-tirata', 'rematore-anelli', 'verticale-libera', 'flessione-polso', 'prono-supinazione']) {
      const e = effs.find((x) => x.ex.key === key)
      if (!e) throw new Error(key)
      unchanged(e, e.ex)
    }
    expect(effs.filter((e) => e.hidden).map((e) => e.index)).toEqual([5])
  })

  it('red: hides every hanging exercise, leaves the rest', () => {
    const effs = applyElbow(TIRATA, lib, 'red')
    const hidden = effs.filter((e) => e.hidden)
    expect(hidden.map((e) => e.index)).toEqual([3, 4, 5])
    for (const e of hidden) {
      expect(e.hiddenReason).toBe('red-hanging')
      expect(e.halved).toBe(false)
    }
    for (const e of effs.filter((x) => !x.hidden)) unchanged(e, e.ex)
  })

  it('leaves days without hanging exercises untouched at any level', () => {
    for (const day of [dayOf('2026-10-01'), dayOf('2026-10-03'), dayOf('2026-10-04')]) {
      const effs = applyElbow(day, lib, 'red')
      effs.forEach((e, i) => unchanged(e, day.exercises[i]))
    }
  })

  it('does not mutate the plan', () => {
    const before = JSON.stringify(TIRATA)
    applyElbow(TIRATA, lib, 'yellow')
    applyElbow(TIRATA, lib, 'red')
    expect(JSON.stringify(TIRATA)).toBe(before)
  })
})

describe('applyElbow on synthetic days', () => {
  const library: Library = {
    ...plan.library,
    'sbarra-libera': { label: 'Sospensione', measure: null, video_query: null, hanging: true, on_yellow: null },
  }
  const synthetic: Day = {
    ...TIRATA,
    exercises: [
      mkEx({ key: 'trazioni', name: 'Trazioni lente', kind: 'reps', sets: 5, sets_max: 5 }),
      mkEx({ key: 'front-lever-raise', name: 'FL raise', kind: 'reps', sets: 3, sets_max: 3 }),
      mkEx({ key: 'sbarra-libera', name: 'Hang', kind: 'hold', sets: 2, sets_max: 3 }),
      mkEx({ key: 'non-in-libreria', name: 'Sconosciuto', kind: 'reps', sets: 4, sets_max: 4 }),
      mkEx({ key: 'trazioni', name: 'Trazioni singola', kind: 'reps', sets: 1, sets_max: 1 }),
      mkEx({ key: 'trazioni', name: 'Trazioni info', kind: 'info', sets: null, sets_max: null }),
      mkEx({ key: 'trazioni-esplosive', name: 'Esplosive', kind: 'reps', sets: 3, sets_max: 5 }),
      mkEx({ key: 'rematore-anelli', name: 'Rematore', kind: 'reps', sets: 3, sets_max: 3 }),
    ],
  }

  it('yellow: halve (ceil), skip, on_yellow null unchanged, unknown key untouched', () => {
    const effs = applyElbow(synthetic, library, 'yellow')
    expect(effs).toHaveLength(8)
    expect(effs[0]).toMatchObject({ hidden: false, sets: 3, setsMax: 3, halved: true })
    expect(effs[1]).toMatchObject({ hidden: true, hiddenReason: 'yellow-skip' })
    unchanged(effs[2], synthetic.exercises[2])
    unchanged(effs[3], synthetic.exercises[3])
    expect(effs[3].lib).toBeNull()
    expect(effs[4]).toMatchObject({ hidden: false, sets: 1, setsMax: 1, halved: true })
    expect(effs[5]).toMatchObject({ hidden: false, sets: null, setsMax: null })
    expect(effs[6]).toMatchObject({ hidden: false, sets: 2, setsMax: 3, halved: true })
    unchanged(effs[7], synthetic.exercises[7])
  })

  it('red: hides hanging ones whatever on_yellow says; unknown key untouched', () => {
    const effs = applyElbow(synthetic, library, 'red')
    expect(effs.map((e) => e.hidden)).toEqual([true, true, true, false, true, true, true, false])
    for (const e of effs.filter((x) => x.hidden)) expect(e.hiddenReason).toBe('red-hanging')
    unchanged(effs[3], synthetic.exercises[3])
  })

  it('keeps setsMax >= sets after halving', () => {
    const odd: Day = { ...TIRATA, exercises: [mkEx({ key: 'trazioni', sets: 5, sets_max: 6 })] }
    const [e] = applyElbow(odd, library, 'yellow')
    expect(e.sets).toBe(3)
    expect(e.setsMax).toBe(3)
  })

  it('handles a day without exercises', () => {
    expect(applyElbow({ ...TIRATA, exercises: [] }, library, 'red')).toEqual([])
  })

  it('never resolves keys from Object.prototype', () => {
    expect(libraryEntry(library, 'trazioni')).toBe(library['trazioni'])
    expect(libraryEntry(library, 'constructor')).toBeNull()
    expect(libraryEntry(library, 'toString')).toBeNull()
    const [e] = applyElbow({ ...TIRATA, exercises: [mkEx({ key: 'constructor' })] }, library, 'red')
    expect(e).toMatchObject({ lib: null, hidden: false })
  })
})

describe('plannedSetCount / isOptional', () => {
  it('counts effective sets of visible, non-info exercises (sets null -> 1)', () => {
    const counts = (level: 'yellow' | 'red' | null) => applyElbow(TIRATA, plan.library, level).map(plannedSetCount)
    expect(counts(null)).toEqual([1, 3, 1, 3, 3, 4, 3, 1, 3, 3])
    expect(counts('yellow')).toEqual([1, 3, 1, 2, 2, 0, 3, 1, 3, 3])
    expect(counts('red')).toEqual([1, 3, 1, 0, 0, 0, 3, 1, 3, 3])
    const day: Day = { ...TIRATA, exercises: [mkEx({ sets: null, sets_max: null }), mkEx({ kind: 'info', sets: null })] }
    expect(applyElbow(day, plan.library, null).map(plannedSetCount)).toEqual([1, 0])
  })

  it('marks the block "Opzionale" of the fixture as optional', () => {
    const GAMBE = dayOf('2026-10-03')
    expect(GAMBE.exercises.filter(isOptional).map((e) => e.key)).toEqual(['camminata-salita'])
    expect(plan.days.flatMap((d) => d.exercises).filter(isOptional)).toHaveLength(1)
    expect(isOptional({ block: 'Extra (facoltativo)' })).toBe(true)
    expect(isOptional({ block: null })).toBe(false)
  })
})

describe('rules texts and labels', () => {
  it('returns the fixture texts', () => {
    expect(rulesText(plan.elbow, 'green')).toBe('Dolore ≤3/10: sessione piena, si progredisce.')
    expect(rulesText(plan.elbow, 'yellow')).toMatch(/^Dolore 4-5\/10: sessione ridotta\./)
    expect(rulesText(plan.elbow, 'red')).toMatch(/^Dolore ≥6\/10: niente sospensioni oggi/)
    expect(stopRule(plan.elbow)).toMatch(/^Formicolio o intorpidimento ad anulare\/mignolo/)
  })

  it('returns null without texts', () => {
    expect(rulesText(null, 'green')).toBeNull()
    expect(stopRule(null)).toBeNull()
    const blank = { ...DEFAULT_ELBOW, rules: { green: '  ', yellow: null, red: null, stop: '' } }
    expect(rulesText(blank, 'green')).toBeNull()
    expect(stopRule(blank)).toBeNull()
  })

  it('labels and emojis', () => {
    expect(levelLabel('green')).toBe('verde')
    expect(levelLabel('yellow')).toBe('giallo')
    expect(levelLabel('red')).toBe('rosso')
    expect(levelEmoji('green')).toBe('🟢')
    expect(levelEmoji('yellow')).toBe('🟡')
    expect(levelEmoji('red')).toBe('🔴')
  })
})
