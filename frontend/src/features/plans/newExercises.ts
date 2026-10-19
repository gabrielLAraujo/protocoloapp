import { normalizeExerciseName } from '../../domain/exerciseNames'
import type { MuscleGroup } from '../../domain/muscleGroups'
import type { WorkoutDocument } from '../../domain/planDocuments'
import type { NewExercise } from './WorkoutPlanEditor'

/** `dayKey/exerciseKey`: survives renames of the exercise (and of its position in the list). */
export const exerciseId = (dayKey: string, exerciseKey: string) => `${dayKey}/${exerciseKey}`

/** The groups the server suggested, assigned to the document's exercises of the same (normalized) name. */
export function initialGroups(doc: WorkoutDocument, suggestions: { name: string; group: MuscleGroup }[]): Record<string, MuscleGroup> {
  const byName = new Map(suggestions.map((s) => [normalizeExerciseName(s.name), s.group]))
  const groups: Record<string, MuscleGroup> = {}
  for (const day of doc.days) {
    for (const ex of day.exercises) {
      const group = byName.get(normalizeExerciseName(ex.name))
      if (group) groups[exerciseId(day.key, ex.key)] = group
    }
  }
  return groups
}

/**
 * Every exercise of the document that the catalog does not know (and that is not already linked by id) needs a group.
 * One entry per distinct normalized name (the first occurrence). Exercises that were removed or renamed to a known one drop out.
 */
export function newExerciseEntries(doc: WorkoutDocument, catalog: ReadonlySet<string>, groups: Record<string, MuscleGroup>): NewExercise[] {
  const seen = new Set<string>()
  const entries: NewExercise[] = []
  for (const day of doc.days) {
    for (const ex of day.exercises) {
      const normalized = normalizeExerciseName(ex.name)
      if (normalized === '' || ex.exerciseId || catalog.has(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      const id = exerciseId(day.key, ex.key)
      entries.push({ id, name: ex.name.trim(), group: groups[id] ?? 'other' })
    }
  }
  return entries
}
