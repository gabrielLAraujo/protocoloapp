import { describe, expect, it } from 'vitest'
import { EQUIPMENT, EXERCISE_DICTIONARY, parseExerciseDictionary } from './exerciseDictionary'
import { matchExercise, normalizeExerciseName } from './exerciseMatch'
import { MUSCLE_GROUPS } from './muscleGroups'

describe('EXERCISE_DICTIONARY', () => {
  it('has the common gym exercises', () => {
    expect(EXERCISE_DICTIONARY.length).toBeGreaterThanOrEqual(150)
  })

  it('uses valid muscle groups and equipment', () => {
    for (const entry of EXERCISE_DICTIONARY) {
      expect(MUSCLE_GROUPS, entry.key).toContain(entry.group)
      expect(EQUIPMENT, entry.key).toContain(entry.equipment)
    }
  })

  it('has unique keys', () => {
    const keys = EXERCISE_DICTIONARY.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never gives the same name or alias to two entries', () => {
    const owner = new Map<string, string>()
    for (const entry of EXERCISE_DICTIONARY) {
      for (const name of [entry.name, ...entry.aliases]) {
        const normalized = normalizeExerciseName(name)
        expect(normalized, `${entry.key}: "${name}"`).not.toBe('')
        const previous = owner.get(normalized)
        if (previous !== undefined && previous !== entry.key) {
          throw new Error(`"${name}" belongs to ${previous} and ${entry.key}`)
        }
        owner.set(normalized, entry.key)
      }
    }
  })

  it('finds every entry by its own name and aliases', () => {
    const context = { userExercises: [], dictionary: EXERCISE_DICTIONARY }
    for (const entry of EXERCISE_DICTIONARY) {
      for (const name of [entry.name, ...entry.aliases]) {
        const result = matchExercise(name, context)
        expect(result.kind === 'dictionary' ? result.entry.key : result.kind, `"${name}"`).toBe(entry.key)
        expect(result.confidence, `"${name}"`).toBe('high')
      }
    }
  })

  it('pairs catalogId and catalogName', () => {
    for (const entry of EXERCISE_DICTIONARY) {
      expect(entry.catalogId === null, entry.key).toBe(entry.catalogName === null)
    }
  })

  it('rejects an invalid document', () => {
    const entry = { key: 'x', name: 'X', aliases: [], group: 'wings', equipment: 'barbell', catalogId: null, catalogName: null }
    expect(() => parseExerciseDictionary({ version: 1, entries: [entry] })).toThrow()
  })
})
