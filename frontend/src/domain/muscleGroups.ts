import type { components } from '../api/schema'

/**
 * Muscle groups as the app uses them: camelCase, like the REST API (`lowerBack`).
 * Sync payloads and plan documents carry the same values in snake_case (`lower_back`): convert at the data boundary
 * with `muscleGroupFromApi` / `muscleGroupToApi`, never by hand.
 */
export type MuscleGroup = components['schemas']['MuscleGroup']

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Peito',
  back: 'Costas',
  shoulders: 'Ombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  quads: 'Quadríceps',
  hamstrings: 'Posteriores',
  glutes: 'Glúteos',
  calves: 'Panturrilhas',
  abs: 'Abdômen',
  forearms: 'Antebraços',
  lowerBack: 'Lombar',
  mobility: 'Mobilidade',
  other: 'Outros',
}

export const MUSCLE_GROUPS = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[]

const toCamel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const toSnake = (value: string) => value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** The app's group for a wire value (`lower_back`; `lowerBack` is accepted too). Null when it is not a known group. */
export function muscleGroupFromApi(value: string): MuscleGroup | null {
  const group = toCamel(value)
  return (MUSCLE_GROUPS as string[]).includes(group) ? (group as MuscleGroup) : null
}

/** The wire value (snake_case) for sync payloads and plan documents. */
export const muscleGroupToApi = (group: MuscleGroup): string => toSnake(group)

export const muscleGroupLabel = (group: MuscleGroup): string => MUSCLE_GROUP_LABELS[group]
