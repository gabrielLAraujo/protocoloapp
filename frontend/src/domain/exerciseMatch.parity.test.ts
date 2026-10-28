import { describe, expect, it } from 'vitest'
import { EXERCISE_DICTIONARY } from './exerciseDictionary'
import { matchExercise, normalizeExerciseName } from './exerciseMatch'
import { hevyTitleToSheetName } from './hevyTitle'

/**
 * Shared Hevy title cases: the backend HevyExerciseMatcherTests (C#, exact match only) checks `expected`; here the device
 * matcher (exact + fuzzy) must give `tsKind` for the same title once it is converted by `hevyTitleToSheetName`.
 */
interface FixtureCase {
  title: string
  userExercises: { id: string; name: string; aliases: string[]; catalogId: string | null }[]
  expected: string | null
  tsKind: 'user' | 'dictionary' | 'none'
}

const files = import.meta.glob<FixtureCase[]>('../../../fixtures/exercise-match-cases.json', { eager: true, import: 'default' })
const cases = Object.values(files)[0] ?? []

describe('matchExercise parity (shared fixture fixtures/exercise-match-cases.json)', () => {
  it('loads the shared cases', () => {
    expect(Object.keys(files)).toHaveLength(1)
    expect(cases.length).toBeGreaterThanOrEqual(10)
  })

  it.each(cases.map((c, index) => [index, c.title, c] as const))('case %i: "%s"', (_index, _title, c) => {
    const result = matchExercise(hevyTitleToSheetName(c.title), {
      userExercises: c.userExercises.map(({ id, name, aliases }) => ({ id, name, aliases })),
      dictionary: EXERCISE_DICTIONARY,
    })
    expect(result.kind).toBe(c.tsKind)
    if (result.kind === 'user') expect(result.exerciseId).toBe(c.expected)
  })
})

describe('hevyTitleToSheetName', () => {
  it.each([
    ['Bench Press (Barbell)', 'Bench Press  barra '],
    ['Supino (Barra)', 'Supino  Barra '],
    ['Lateral Raise (Dumbbell)', 'Lateral Raise  halter '],
    ['Triceps Pushdown (Cable)', 'Triceps Pushdown  polia '],
    ['Chest Press (Machine)', 'Chest Press  maquina '],
    ['Squat (Smith Machine)', 'Squat  smith '],
    ['Barbellish Row', 'Barbellish Row'],
  ])('%s', (title, expected) => {
    expect(hevyTitleToSheetName(title)).toBe(expected)
  })
})

// The same strings and results are asserted by the C# ExerciseWords tests.
describe('normalizeExerciseName (values mirrored in C#)', () => {
  it.each([
    ['Elevação Lateral Sentada', 'elevacao lateral sentada'],
    ['Supino inclinado 3x12', 'supino inclinado'],
    ['Rosca direta (parcial) 10kg', 'rosca direta'],
    ['Supino c/ barra', 'supino barra'],
    ['Crucifixo + drop', 'crucifixo'],
  ])('%s', (name, expected) => {
    expect(normalizeExerciseName(name)).toBe(expected)
  })
})
