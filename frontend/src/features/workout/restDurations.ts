import type { PlannedExercise } from '../../domain/planDocuments'

/**
 * Rest after each set of a planned exercise: its sequence (positions are kept, so a 0 means "no rest after that set"),
 * else its fixed rest; null when there is no rest to run.
 */
export function restDurations(planned: PlannedExercise): number[] | null {
  const sequence = planned.restSequence?.filter((n) => n >= 0) ?? []
  if (sequence.some((n) => n > 0)) return sequence
  return planned.restSeconds && planned.restSeconds > 0 ? [planned.restSeconds] : null
}
