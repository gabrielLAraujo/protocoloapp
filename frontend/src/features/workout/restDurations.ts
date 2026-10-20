import type { PlannedExercise } from '../../domain/planDocuments'

/**
 * Rest after each set of a planned exercise: its sequence (positions are kept, so a 0 means "no rest after that set"),
 * else the intervals of its SST technique, else its fixed rest; null when there is no rest to run.
 */
export function restDurations(planned: PlannedExercise): number[] | null {
  const sequence = planned.restSequence?.filter((n) => n >= 0) ?? []
  if (sequence.some((n) => n > 0)) return sequence
  const sst = planned.techniques?.find((t) => t.type === 'sst')
  if (sst && sst.type === 'sst' && sst.rests.some((n) => n > 0)) return sst.rests
  return planned.restSeconds && planned.restSeconds > 0 ? [planned.restSeconds] : null
}
