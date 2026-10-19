import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { LocalDb } from '../../data/localDb'
import { planRepo } from '../../data/planRepo'
import { normalizeExerciseName } from '../../domain/exerciseNames'
import { parseWorkoutDocument, type PlannedExercise, type WorkoutDocument } from '../../domain/planDocuments'
import type { WorkoutPlanAt } from '../../domain/rotation'
import { localDate } from '../checkin/localDate'

export interface WorkoutPlanEntry {
  id: string
  document: WorkoutDocument
  /** What `resolveDay` needs: the local date the version was activated. */
  at: WorkoutPlanAt
}

/**
 * Every workout version that was ever active (active + archived), oldest activation first. The rotation of a day is
 * resolved with the version that was active on that day, so older sessions keep pointing at their own version.
 */
export async function loadWorkoutPlans(db: LocalDb): Promise<WorkoutPlanEntry[]> {
  const versions = await planRepo.list(db, 'workout')
  const entries: { entry: WorkoutPlanEntry; activatedAt: string }[] = []
  for (const v of versions) {
    if (v.status === 'draft' || v.activatedAt === null) continue
    const parsed = parseWorkoutDocument(v.document)
    if (!parsed.ok) continue
    entries.push({
      activatedAt: v.activatedAt,
      entry: {
        id: v.id,
        document: parsed.value,
        at: {
          planVersionId: v.id,
          activatedOn: localDate(new Date(v.activatedAt)),
          rotation: parsed.value.rotation ?? { type: '' },
        },
      },
    })
  }
  // Full timestamp order: two activations on the same local day resolve to the newest (`activePlanAt` keeps the later entry on a tie).
  return entries.sort((a, b) => Date.parse(a.activatedAt) - Date.parse(b.activatedAt)).map((e) => e.entry)
}

/** The catalog exercise of a planned one: by id, else by normalized name (or alias). */
export function findExercise(catalog: ExerciseLocal[], planned: PlannedExercise): ExerciseLocal | null {
  if (planned.exerciseId) {
    const byId = catalog.find((e) => e.id === planned.exerciseId)
    if (byId) return byId
  }
  const key = normalizeExerciseName(planned.name)
  if (key === '') return null
  return catalog.find((e) => e.normalizedName === key || e.aliases.some((a) => normalizeExerciseName(a) === key)) ?? null
}
