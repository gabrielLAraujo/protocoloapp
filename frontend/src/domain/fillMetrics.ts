/**
 * The metrics a questionnaire answer can be filled with, computed by the server (`GET /api/update-cycles/{id}/metrics`).
 * A closed list in the order of the contract, identical to the server's `FillMetric.All`.
 */
export const FILL_METRICS = [
  'diet_error_pct',
  'diet_wrong_meals',
  'diet_deviations',
  'missed_workouts',
  'missed_cardio',
  'items_missed',
  'items_used',
  'strength_changes',
  'training_changes',
  'weight',
  'water_avg',
  'sleep_avg',
  'energy_avg',
  'anxiety_avg',
  'stress_avg',
  'mood_avg',
  'checkin_notes',
] as const

export type FillMetric = (typeof FILL_METRICS)[number]

export const isFillMetric = (value: string): value is FillMetric => (FILL_METRICS as readonly string[]).includes(value)

/** The metrics that accept `fillOptions.week` (one week of the cycle), as the server's `FillMetric.WeekMetrics`. */
export const WEEK_FILL_METRICS: readonly FillMetric[] = ['diet_error_pct', 'diet_wrong_meals', 'diet_deviations', 'missed_workouts', 'missed_cardio']
/** The metrics that accept `fillOptions.categories`, as the server's `FillMetric.CategoryMetrics`. */
export const CATEGORY_FILL_METRICS: readonly FillMetric[] = ['items_missed', 'items_used']
/** The metrics that accept `fillOptions.groups`, as the server's `FillMetric.GroupMetrics`. */
export const GROUP_FILL_METRICS: readonly FillMetric[] = ['strength_changes']

export const acceptsWeek = (metric: string | null | undefined) => !!metric && (WEEK_FILL_METRICS as readonly string[]).includes(metric)
export const acceptsCategories = (metric: string | null | undefined) => !!metric && (CATEGORY_FILL_METRICS as readonly string[]).includes(metric)
export const acceptsGroups = (metric: string | null | undefined) => !!metric && (GROUP_FILL_METRICS as readonly string[]).includes(metric)

/** `fillOptions.week`: 1 to 6. */
export const MIN_FILL_WEEK = 1
export const MAX_FILL_WEEK = 6

/** Protocol item categories (the plan documents' `category`). */
export const ITEM_CATEGORIES = ['supplement', 'compound', 'hormone', 'thermogenic', 'sleep_optional'] as const
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]
