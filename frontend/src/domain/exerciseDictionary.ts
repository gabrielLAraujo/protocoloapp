import { z } from 'zod'
import raw from './exercise-dictionary.json'
import { MUSCLE_GROUPS, type MuscleGroup } from './muscleGroups'

/**
 * The pt-BR dictionary of common gym exercises: canonical name, the spellings and abbreviations seen in Brazilian
 * training sheets, muscle group, equipment and the closest ExerciseDB item (`catalogId`, with its `catalogName` kept
 * for review). Generic gym knowledge only, no user data.
 *
 * The canonical file lives next to this module (not under the repository's `fixtures/`) because the front's Docker
 * build context only contains `frontend/`, and the app needs the dictionary at run time, not just in tests.
 */

export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'smith', 'bodyweight', 'band', 'other'] as const
export type Equipment = (typeof EQUIPMENT)[number]

export interface DictionaryEntry {
  key: string
  name: string
  aliases: string[]
  group: MuscleGroup
  equipment: Equipment
  catalogId: string | null
  catalogName: string | null
}

const entrySchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  group: z.enum(MUSCLE_GROUPS as [MuscleGroup, ...MuscleGroup[]]),
  equipment: z.enum(EQUIPMENT),
  catalogId: z.string().min(1).nullable(),
  catalogName: z.string().min(1).nullable(),
})

const dictionarySchema = z.object({ version: z.number().int(), entries: z.array(entrySchema) })

/** Validates a dictionary document; throws on an invalid one (the bundled file is checked by tests). */
export function parseExerciseDictionary(value: unknown): DictionaryEntry[] {
  return dictionarySchema.parse(value).entries
}

export const EXERCISE_DICTIONARY: readonly DictionaryEntry[] = parseExerciseDictionary(raw)
