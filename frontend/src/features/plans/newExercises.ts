import { normalizeExerciseName } from '../../domain/exerciseNames'
import type { MuscleGroup } from '../../domain/muscleGroups'
import type { WorkoutDocument } from '../../domain/planDocuments'

/** An exercise of the document that the catalog does not know yet: it needs a muscle group. `id` is `dayKey/exerciseKey`. */
export type NewExercise = { id: string; name: string; group: MuscleGroup; catalogId?: string | null }

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

/** The catalog items the draft carries for its new exercises (by document exercise), so a save does not lose them. */
export function initialCatalogIds(doc: WorkoutDocument, suggestions: { name: string; catalogId?: string | null }[]): Record<string, string> {
  const byName = new Map(suggestions.flatMap((s) => (s.catalogId ? [[normalizeExerciseName(s.name), s.catalogId] as const] : [])))
  const links: Record<string, string> = {}
  for (const day of doc.days) {
    for (const ex of day.exercises) {
      const catalogId = byName.get(normalizeExerciseName(ex.name))
      if (catalogId) links[exerciseId(day.key, ex.key)] = catalogId
    }
  }
  return links
}

/**
 * Every exercise of the document that the catalog does not know (and that is not already linked by id) needs a group.
 * One entry per distinct normalized name (the first occurrence). Exercises that were removed or renamed to a known one drop out.
 */
export function newExerciseEntries(
  doc: WorkoutDocument,
  catalog: ReadonlySet<string>,
  groups: Record<string, MuscleGroup>,
  catalogIds: Record<string, string> = {},
): NewExercise[] {
  const seen = new Set<string>()
  const entries: NewExercise[] = []
  for (const day of doc.days) {
    for (const ex of day.exercises) {
      const normalized = normalizeExerciseName(ex.name)
      if (normalized === '' || ex.exerciseId || catalog.has(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      const id = exerciseId(day.key, ex.key)
      entries.push({ id, name: ex.name.trim(), group: groups[id] ?? 'other', catalogId: catalogIds[id] ?? null })
    }
  }
  return entries
}
