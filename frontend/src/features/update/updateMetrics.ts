import { z } from 'zod'

// GET /api/update-cycles/{id}/metrics (camelCase), as fixed in the plan's data contract. Dates are yyyy-MM-dd.

const count = z.number().int().nonnegative()
const date = z.string()

const rate = z.object({ planned: count, done: count, errorPct: z.number().nullable() })
const weekRange = { week: z.number().int().positive(), from: date, to: date }
const reasonCount = z.object({ reason: z.string(), count })
const trend = z.object({
  exerciseId: z.string(),
  name: z.string(),
  firstE1rm: z.number(),
  lastE1rm: z.number(),
  delta: z.number(),
  sessions: count,
})
const avg = z.object({ avg: z.number().nullable(), days: count })
const weighIn = z.object({ date, kg: z.number() }).nullable()
/** Item category (`supplement`, `compound`…); null when the item left the protocol. */
const category = z.string().nullable().default(null)
// Fields added later default to empty, so metrics cached by an older version still read offline.
const weeks = <T extends z.ZodType>(item: T) => z.array(item).default([])

export const updateMetricsSchema = z.object({
  cycleId: z.string(),
  from: date,
  to: date,
  computedAt: z.string(),
  dietErrorPct: z.object({ cycle: rate, weeks: z.array(rate.extend(weekRange)) }),
  dietWrongMeals: z.array(z.object({ ...weekRange, count, reasons: z.array(reasonCount) })),
  dietDeviations: z.array(
    z.object({
      date,
      mealKey: z.string().nullable(),
      mealLabel: z.string().nullable(),
      time: z.string().nullable(),
      description: z.string(),
      quantity: z.string().nullable(),
    }),
  ),
  missedWorkouts: z.object({
    planned: count,
    done: count,
    missedDates: z.array(date),
    weeks: weeks(z.object({ ...weekRange, planned: count, done: count, missedDates: z.array(date) })),
  }),
  missedCardio: z.object({ planned: count, done: count, weeks: weeks(z.object({ ...weekRange, planned: count, done: count })) }),
  itemsMissed: z.array(z.object({ key: z.string(), name: z.string(), category, missed: count, reasons: z.array(reasonCount) })),
  itemsUsed: z.array(z.object({ key: z.string(), name: z.string(), category, done: count, partial: count, planned: count })).default([]),
  strengthChanges: z.array(z.object({ group: z.string(), best: z.array(trend), worst: z.array(trend) })),
  trainingChanges: z.array(
    z.object({
      date,
      kind: z.enum(['plan_activated', 'swapped', 'skipped']),
      exerciseName: z.string().nullable(),
      replacementName: z.string().nullable(),
    }),
  ),
  weight: z.object({ start: weighIn, end: weighIn, deltaKg: z.number().nullable() }),
  waterAvg: z.object({ avgL: z.number().nullable(), targetL: z.number().nullable(), days: count }),
  sleepAvg: avg,
  energyAvg: z.object({ wake: avg, day: avg }),
  anxietyAvg: avg,
  checkinNotes: z.array(z.object({ date, note: z.string() })),
})

export type UpdateMetrics = z.infer<typeof updateMetricsSchema>
export type MetricsAvg = z.infer<typeof avg>
export type MetricsTrend = z.infer<typeof trend>
export type MetricsItemUse = UpdateMetrics['itemsUsed'][number]
