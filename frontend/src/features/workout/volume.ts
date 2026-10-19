import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SetLocal } from '../../data/workoutRepo'
import { MUSCLE_GROUPS, type MuscleGroup } from '../../domain/muscleGroups'

/** Σ weight × reps of the working sets (warm-ups do not count). */
export const volumeOf = (sets: SetLocal[]): number => sets.reduce((sum, s) => (s.kind === 'warmup' ? sum : sum + s.weightKg * s.reps), 0)

/** Volume per primary muscle group, only the groups with volume, in the canonical group order. */
export function volumeByGroup(sets: SetLocal[], exercises: ExerciseLocal[]): { group: MuscleGroup; volume: number }[] {
  const groupOf = new Map(exercises.map((e) => [e.id, e.primaryMuscleGroup]))
  const totals = new Map<MuscleGroup, number>()
  for (const s of sets) {
    if (s.kind === 'warmup') continue
    const group = groupOf.get(s.exerciseId) ?? 'other'
    totals.set(group, (totals.get(group) ?? 0) + s.weightKg * s.reps)
  }
  return MUSCLE_GROUPS.filter((g) => (totals.get(g) ?? 0) > 0).map((group) => ({ group, volume: totals.get(group)! }))
}
