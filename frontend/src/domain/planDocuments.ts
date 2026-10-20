import { z } from 'zod'
import { isCalendarDate } from './calendarDate'

/**
 * Typed plan documents (`plan_versions.document`), mirroring backend `PlanDocuments.cs`: camelCase keys, read leniently
 * (a missing/null list is empty, unknown properties are ignored). Dates are `yyyy-MM-dd`.
 */

const date = z.string().refine(isCalendarDate, { message: 'invalid date' })
const optional = <T extends z.ZodType>(schema: T) => schema.nullish()
const list = <T extends z.ZodType>(schema: T) => z.preprocess((v) => v ?? [], z.array(schema))
/** A string the backend reads leniently: missing or null becomes the default. */
const str = (fallback: string) => z.preprocess((v) => v ?? fallback, z.string())
const text = str('')

const mealItemSchema = z.object({
  food: text,
  grams: optional(z.number()),
  alternatives: list(z.string()),
})

const mealSchema = z.object({
  key: text,
  label: text,
  items: list(mealItemSchema),
  notes: optional(z.string()),
})

/** `type`: daily | weekdays (`days`) | every_n_days (`n`, `anchor`) | training_days_only | off_days_only. */
const scheduleSchema = z.object({
  type: str('daily'),
  days: optional(z.array(z.string())),
  n: optional(z.number().int()),
  anchor: optional(date),
})

/** `category`: supplement|compound|hormone|thermogenic|sleep_optional. `timing`: any|fasting|after_meal|before_bed|pre_workout|intra_workout|post_workout|with_meal:<slot>. */
const protocolItemSchema = z.object({
  key: text,
  category: text,
  name: text,
  doseText: optional(z.string()),
  timing: str('any'),
  schedule: scheduleSchema.default({ type: 'daily' }),
})

const cardioPlanSchema = z.object({
  sessionsPerWeek: optional(z.number().int()),
  daily: optional(z.boolean()),
  durationMin: optional(z.number().int()),
  intensity: optional(z.string()),
  preferredTime: optional(z.string()),
})

/** `kind`: water_min_l|free_meals_per_week (`value`) | text (`text`). */
const guidelineSchema = z.object({
  kind: text,
  value: optional(z.number()),
  text: optional(z.string()),
})

export const protocolDocumentSchema = z.object({
  phaseName: optional(z.string()),
  updateDate: optional(date),
  billingDate: optional(date),
  meals: list(mealSchema),
  items: list(protocolItemSchema),
  cardio: optional(cardioPlanSchema),
  guidelines: list(guidelineSchema),
  trainingSplitNote: optional(z.string()),
})

export const OFF = 'off'
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** `type` = sequence (`items`, optional `anchor`) | fixed_weekdays (`map` of mon..sun). `off` is a rest day. */
export const rotationSchema = z.object({
  type: text,
  items: optional(z.array(z.string())),
  anchor: optional(date),
  map: optional(z.record(z.string(), z.string())),
})

const plannedSetSchema = z.object({
  repsMin: z.number().int().default(0),
  repsMax: z.number().int().default(0),
  technique: optional(z.string()),
  /** Drop sub-sets to do after this set (0–5). */
  drops: optional(z.number().int().min(0).max(5)),
  /** Rest-pause sub-sets to do after this set (0–5). */
  restPause: optional(z.number().int().min(0).max(5)),
})

const TECHNIQUE_TYPES = new Set([
  'drop',
  'rest_pause',
  'biset',
  'sst',
  'peak',
  'isometric',
  'partials',
  'zero_point',
  'progressive_load',
  'stretch_interval',
])

/** A technique type this app does not know (written by a newer version) is dropped instead of rejecting the document. */
function dropUnknownTechniques(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((item) => {
    const type = typeof item === 'object' && item !== null ? (item as { type?: unknown }).type : undefined
    if (typeof type === 'string' && !TECHNIQUE_TYPES.has(type)) {
      if (import.meta.env?.DEV) console.warn(`Unknown technique type ignored: ${type}`)
      return false
    }
    return true
  })
}

/** Structured technique of an exercise, discriminated by `type`. An unknown `type` makes the document invalid. */
export const techniqueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('drop'),
    count: z.number().int().min(1).max(5),
    /** `last`, `all` or the 0-based indexes of the sets that get the drops. */
    sets: z.union([z.enum(['last', 'all']), z.array(z.number().int().min(0))]),
  }),
  z.object({ type: z.literal('rest_pause'), count: z.number().int().min(1).max(5) }),
  /** `with`: key of another exercise of the same day. */
  z.object({ type: z.literal('biset'), with: z.string().min(1) }),
  z.object({ type: z.literal('sst'), rests: z.array(z.number().int().min(0).max(900)).min(1) }),
  z.object({ type: z.literal('peak'), seconds: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal('isometric'), seconds: z.number().int().min(1).max(120) }),
  z.object({ type: z.literal('partials'), reps: optional(z.number().int().min(1).max(30)) }),
  z.object({ type: z.literal('zero_point'), seconds: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal('progressive_load') }),
  z.object({ type: z.literal('stretch_interval') }),
])

const plannedExerciseSchema = z.object({
  key: text,
  exerciseId: optional(z.guid()),
  name: text,
  sets: list(plannedSetSchema),
  restSeconds: optional(z.number().int()),
  restSequence: optional(z.array(z.number().int())),
  technique: optional(z.string()),
  /** Structured techniques; the free text left over stays in `technique`. */
  techniques: optional(z.preprocess(dropUnknownTechniques, z.array(techniqueSchema))),
  /** Key of the exercise this one is combined with (bi-set). */
  supersetWith: optional(z.string()),
  /** Draft only: the exercise catalog item (media) the device matched; activation links it to an exercise that has none. */
  catalogId: optional(z.string()),
  /** Draft only: true when the user picked this exercise in the review, so activation keeps the PDF name as its alias. */
  aliasConfirmed: optional(z.boolean()),
})

const workoutDaySchema = z.object({
  key: text,
  name: text,
  notes: optional(z.string()),
  exercises: list(plannedExerciseSchema),
})

export const workoutDocumentSchema = z
  .object({
    rotation: optional(rotationSchema),
    days: list(workoutDaySchema),
  })
  .superRefine((doc, ctx) => {
    // Same rules as the server validator: drop indexes inside the sets, bi-set with another exercise of the same day.
    doc.days.forEach((day, i) => {
      const keys = new Set(day.exercises.map((e) => e.key))
      day.exercises.forEach((exercise, j) => {
        exercise.techniques?.forEach((technique, k) => {
          const path = ['days', i, 'exercises', j, 'techniques', k]
          if (technique.type === 'drop' && Array.isArray(technique.sets) && technique.sets.some((n) => n >= exercise.sets.length)) {
            ctx.addIssue({ code: 'custom', path: [...path, 'sets'], message: 'set index out of range' })
          }
          if (technique.type === 'biset' && (technique.with === exercise.key || !keys.has(technique.with))) {
            ctx.addIssue({ code: 'custom', path: [...path, 'with'], message: 'bi-set needs another exercise of the same day' })
          }
        })
      })
    })
  })

export type ProtocolDocument = z.infer<typeof protocolDocumentSchema>
export type Meal = z.infer<typeof mealSchema>
export type MealItem = z.infer<typeof mealItemSchema>
export type ProtocolItem = z.infer<typeof protocolItemSchema>
export type Schedule = z.infer<typeof scheduleSchema>
export type CardioPlan = z.infer<typeof cardioPlanSchema>
export type Guideline = z.infer<typeof guidelineSchema>
export type WorkoutDocument = z.infer<typeof workoutDocumentSchema>
export type Rotation = z.infer<typeof rotationSchema>
export type WorkoutDay = z.infer<typeof workoutDaySchema>
export type PlannedExercise = z.infer<typeof plannedExerciseSchema>
export type Technique = z.infer<typeof techniqueSchema>
export type TechniqueType = Technique['type']
export type PlannedSet = z.infer<typeof plannedSetSchema>

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['document'] }
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return { ok: false, errors }
}

export const parseProtocolDocument = (raw: unknown): ParseResult<ProtocolDocument> =>
  parseWith<ProtocolDocument>(protocolDocumentSchema as unknown as z.ZodType<ProtocolDocument>, raw)

export const parseWorkoutDocument = (raw: unknown): ParseResult<WorkoutDocument> =>
  parseWith<WorkoutDocument>(workoutDocumentSchema as unknown as z.ZodType<WorkoutDocument>, raw)
