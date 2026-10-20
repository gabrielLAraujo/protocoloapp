import type { PlannedExercise } from '../../domain/planDocuments'

/**
 * Rest after each set of a planned exercise: its sequence (positions are kept, so a 0 means "no rest after that set"),
 * else the intervals of its SST technique (its fixed rest after the last set), else its fixed rest; null when there is no rest to run.
 */
export function restDurations(planned: PlannedExercise): number[] | null {
  const sequence = planned.restSequence?.filter((n) => n >= 0) ?? []
  if (sequence.some((n) => n > 0)) return sequence
  const sst = planned.techniques?.find((t) => t.type === 'sst')
  if (sst && sst.type === 'sst' && sst.rests.some((n) => n > 0)) {
    // The intervals run between the sets; after the last one the exercise's own rest applies (0 when none).
    const n = Math.max(planned.sets.length, 1)
    return Array.from({ length: n }, (_, i) => (i < n - 1 ? sst.rests[Math.min(i, sst.rests.length - 1)]! : (planned.restSeconds ?? 0)))
  }
  return planned.restSeconds && planned.restSeconds > 0 ? [planned.restSeconds] : null
}
