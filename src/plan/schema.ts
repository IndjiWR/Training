import { z } from 'zod'

// Italian messages for every zod error shown in the UI.
z.config(z.locales.it())

/**
 * Contract for scheda-YYYY-MM-DD.json, schema 1.
 * The source format is fixed (see scheda-corrente.json): this file only describes it.
 * Optional/nullable fields are normalised on parse (missing -> null, missing booleans -> false)
 * so the rest of the app never has to deal with `undefined`.
 */

export const DAY_TYPES = ['TIRATA', 'SPINTA', 'GAMBE', 'RIPOSO'] as const
export const KINDS = ['reps', 'hold', 'time', 'distance', 'attempts', 'max', 'info'] as const
export const UNITS = ['rep', 's', 'min', 'm', '%max', 'cm'] as const
export const ON_YELLOW = ['skip', 'halve'] as const

export type DayType = (typeof DAY_TYPES)[number]
export type Kind = (typeof KINDS)[number]
export type Unit = (typeof UNITS)[number]
export type OnYellow = (typeof ON_YELLOW)[number]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `T | null`, accepting null or a missing field. */
const opt = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null)
/** boolean, missing/null -> false. */
const flag = z.boolean().nullish().transform((v) => v ?? false)

const isoDate = z.string().regex(ISO_DATE, 'data attesa nel formato AAAA-MM-GG')
const count = z.number().int().nonnegative()
const amount = z.number().nonnegative()

export const ExerciseSchema = z.object({
  n: opt(z.number().int()),
  key: z.string().min(1),
  block: opt(z.string()),
  name: z.string().min(1),
  dose: opt(z.string()),
  kind: z.enum(KINDS),
  sets: opt(count),
  sets_max: opt(count),
  target_min: opt(z.number()),
  target_max: opt(z.number()),
  unit: opt(z.enum(UNITS)),
  per_side: flag,
  rest: opt(z.string()),
  rest_s: opt(amount),
  rest_max_s: opt(amount),
  note: opt(z.string()),
  test: flag,
  home: flag,
})

export const DaySchema = z.object({
  date: isoDate,
  weekday: opt(z.string()),
  type: z.enum(DAY_TYPES),
  title: opt(z.string()),
  where: opt(z.string()),
  bring: opt(z.string()),
  duration: opt(z.string()),
  note: opt(z.string()),
  exercises: z
    .array(ExerciseSchema)
    .nullish()
    .transform((v) => v ?? []),
})

export const LibraryEntrySchema = z.object({
  label: z.string().min(1),
  /** Unit of the result to record; "0-10" = pain score. */
  measure: opt(z.string()),
  video_query: opt(z.string()),
  hanging: flag,
  on_yellow: opt(z.enum(ON_YELLOW)),
})

export const WarmupItemSchema = z.object({
  name: z.string().min(1),
  dose: opt(z.string()),
  note: opt(z.string()),
})

export const WarmupSchema = z.object({
  title: opt(z.string()),
  items: z
    .array(WarmupItemSchema)
    .nullish()
    .transform((v) => v ?? []),
})

export const ElbowRulesSchema = z.object({
  green: opt(z.string()),
  yellow: opt(z.string()),
  red: opt(z.string()),
  stop: opt(z.string()),
})

export const ElbowSchema = z
  .object({
    green_max: z.number().min(0).max(10),
    yellow_max: z.number().min(0).max(10),
    rules: ElbowRulesSchema.nullish().transform(
      (v) => v ?? { green: null, yellow: null, red: null, stop: null },
    ),
  })
  .refine((e) => e.yellow_max >= e.green_max, {
    message: 'yellow_max deve essere maggiore o uguale a green_max',
    path: ['yellow_max'],
  })

export const PlanTestSchema = z.object({
  name: z.string().min(1),
  unit: opt(z.string()),
  value: opt(z.union([z.number(), z.string()])),
  when: opt(z.string()),
  note: opt(z.string()),
})

export const PlanSchema = z.object({
  schema: z.literal(1),
  id: z.string().min(1),
  generated_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'generated_at non è una data/ora ISO valida'),
  cycle: opt(z.number()),
  week: opt(z.number()),
  title: opt(z.string()),
  period: opt(z.string()),
  start: opt(isoDate),
  end: opt(isoDate),
  next_checkin: opt(z.string()),
  goals: opt(z.string()),
  elbow: opt(ElbowSchema),
  warmups: z
    .record(z.string(), WarmupSchema)
    .nullish()
    .transform((v) => v ?? {}),
  library: z.record(z.string(), LibraryEntrySchema),
  days: z.array(DaySchema).min(1, 'la scheda non contiene giorni'),
  tests: z
    .array(PlanTestSchema)
    .nullish()
    .transform((v) => v ?? []),
})

export type Exercise = z.infer<typeof ExerciseSchema>
export type Day = z.infer<typeof DaySchema>
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>
export type Library = Record<string, LibraryEntry>
export type WarmupItem = z.infer<typeof WarmupItemSchema>
export type Warmup = z.infer<typeof WarmupSchema>
export type ElbowRules = z.infer<typeof ElbowRulesSchema>
export type Elbow = z.infer<typeof ElbowSchema>
export type PlanTest = z.infer<typeof PlanTestSchema>
export type Plan = z.infer<typeof PlanSchema>

export type ParsePlanResult = { ok: true; plan: Plan } | { ok: false; error: string }

/** Human-readable Italian description of a zod error, one line per issue (max `limit`). */
export function formatIssues(error: z.ZodError, limit = 6): string {
  const lines = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.length ? formatPath(issue.path) : '(radice)'
    return `• ${path}: ${issue.message}`
  })
  const more = error.issues.length - limit
  if (more > 0) lines.push(`• …e altri ${more} errori`)
  return lines.join('\n')
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`
    const name = String(part)
    return acc ? `${acc}.${name}` : name
  }, '')
}

/** Validates unknown JSON against the plan contract. Never throws. */
export function parsePlan(json: unknown): ParsePlanResult {
  if (json && typeof json === 'object' && 'error' in json && !('days' in json)) {
    const msg = String((json as { error: unknown }).error)
    return { ok: false, error: `Il server ha risposto con un errore: ${msg}` }
  }
  const result = PlanSchema.safeParse(json)
  if (result.success) return { ok: true, plan: result.data }
  return {
    ok: false,
    error: `La scheda non rispetta il formato atteso (schema 1):\n${formatIssues(result.error)}`,
  }
}
