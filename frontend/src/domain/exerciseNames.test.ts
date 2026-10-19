import { describe, expect, it } from 'vitest'
import { normalizeExerciseName } from './exerciseNames'

describe('normalizeExerciseName', () => {
  it('matches the same exercise written differently', () => {
    expect(normalizeExerciseName('Supino inclinado c/ halteres')).toBe(normalizeExerciseName('supino inclinado halteres'))
    expect(normalizeExerciseName('Supino inclinado com halteres')).toBe('supino inclinado halteres')
  })
  it('drops accents, punctuation and filler words', () => {
    expect(normalizeExerciseName('  Elevação (lateral) no Cabo! ')).toBe('elevacao lateral cabo')
    expect(normalizeExerciseName('Rosca c/halteres')).toBe('rosca halteres')
    expect(normalizeExerciseName('Abc/ d')).toBe('abc d')
  })
})
