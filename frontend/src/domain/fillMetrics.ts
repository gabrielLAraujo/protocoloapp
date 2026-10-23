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
