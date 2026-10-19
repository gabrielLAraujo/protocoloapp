import { describe, expect, it } from 'vitest'
import { MUSCLE_GROUPS, muscleGroupFromApi, muscleGroupLabel, muscleGroupToApi } from './muscleGroups'

describe('muscleGroups', () => {
  it('converts lower_back and lowerBack both ways', () => {
    expect(muscleGroupFromApi('lower_back')).toBe('lowerBack')
    expect(muscleGroupFromApi('lowerBack')).toBe('lowerBack')
    expect(muscleGroupToApi('lowerBack')).toBe('lower_back')
    expect(muscleGroupFromApi('chest')).toBe('chest')
    expect(muscleGroupFromApi('nope')).toBeNull()
  })

  it('round-trips every group and labels it in pt-BR', () => {
    for (const group of MUSCLE_GROUPS) expect(muscleGroupFromApi(muscleGroupToApi(group))).toBe(group)
    expect(MUSCLE_GROUPS).toHaveLength(14)
    expect(muscleGroupLabel('lowerBack')).toBe('Lombar')
    expect(muscleGroupLabel('hamstrings')).toBe('Posteriores')
  })
})
