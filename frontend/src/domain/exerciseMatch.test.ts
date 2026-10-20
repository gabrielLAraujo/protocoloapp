import { describe, expect, it } from 'vitest'
import type { DictionaryEntry } from './exerciseDictionary'
import { EXERCISE_DICTIONARY } from './exerciseDictionary'
import { editDistance, matchExercise, normalizeExerciseName, type MatchResult, type UserExercise } from './exerciseMatch'

const dictionary = EXERCISE_DICTIONARY
const keyOf = (result: MatchResult) => (result.kind === 'dictionary' ? result.entry.key : result.kind)
const match = (name: string, userExercises: UserExercise[] = []) => matchExercise(name, { userExercises, dictionary })

describe('normalizeExerciseName', () => {
  it('lowercases and drops accents and punctuation', () => {
    expect(normalizeExerciseName('Elevação Lateral!')).toBe('elevacao lateral')
    expect(normalizeExerciseName('Tríceps-Francês')).toBe('triceps frances')
  })

  it('drops parenthetical text, numbers with units and set notation', () => {
    expect(normalizeExerciseName('Puxada alta (pegada aberta)')).toBe('puxada alta')
    expect(normalizeExerciseName('Leg Press 45°')).toBe('leg press')
    expect(normalizeExerciseName('Mesa flexora 3x12 10kg')).toBe('mesa flexora')
    expect(normalizeExerciseName('Supino 30 graus')).toBe('supino')
  })

  it('drops technique and filler words', () => {
    expect(normalizeExerciseName('Elevação lateral c/ pico de contração 2 seg')).toBe('elevacao lateral')
    expect(normalizeExerciseName('Cadeira extensora com drop + intervalo 30s')).toBe('cadeira extensora')
    expect(normalizeExerciseName('Rosca c/halteres rest pause')).toBe('rosca halteres')
  })
})

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('puley', 'pulley')).toBe(1)
    expect(editDistance('extenssora', 'extensora')).toBe(1)
    expect(editDistance('supinda', 'supinada')).toBe(1)
    expect(editDistance('flexora', 'flexor')).toBe(1)
  })
  it('stops past the limit', () => {
    expect(editDistance('agachamento', 'desenvolvimento')).toBe(3)
  })
})

describe('matchExercise (dictionary)', () => {
  it.each([
    ['Puxada alta', 'lat_pulldown'],
    ['puley frente', 'lat_pulldown'],
    ['Pulley frente (pegada aberta)', 'lat_pulldown'],
    ['leg 45', 'leg_press_45'],
    ['Leg press 45°', 'leg_press_45'],
    ['terra sumô', 'sumo_deadlift'],
    ['Terra sumo', 'sumo_deadlift'],
    ['Stiff c/ barra', 'stiff'],
    ['cadeira extenssora', 'leg_extension'],
    ['extensor', 'leg_extension'],
    ['flexor deitado', 'lying_leg_curl'],
    ['Mesa flexora 4x10', 'lying_leg_curl'],
    ['voador', 'pec_deck'],
    ['Peck deck', 'pec_deck'],
    ['serrote', 'one_arm_dumbbell_row'],
    ['elevaçao lateral', 'lateral_raise'],
    ['Elevação lateral c/ pico de contração 2 seg', 'lateral_raise'],
    ['rosca scot', 'barbell_preacher_curl'],
    ['Rosca Direta Barra W', 'ez_bar_curl'],
    ['triceps puley', 'triceps_pushdown'],
    ['TRICEPS TESTA', 'skull_crusher'],
    ['tríceps francez', 'dumbbell_french_press'],
    ['panturrilha em pe', 'standing_calf_raise'],
    ['elevação pelvica', 'hip_thrust'],
    ['agachamento bulgaro', 'bulgarian_split_squat'],
    ['supino reto halter', 'dumbbell_bench_press'],
    ['Supino inclinado c/ halteres', 'dumbbell_incline_press'],
    ['remada curvada supinda', 'underhand_barbell_row'],
    ['lombar banco romano', 'hyperextension'],
    ['hiperextensao', 'hyperextension'],
    ['abdominal infra', 'reverse_crunch'],
  ])('"%s" → %s (high)', (name, key) => {
    const result = match(name)
    expect(keyOf(result)).toBe(key)
    expect(result.confidence).toBe('high')
  })

  it('carries group and catalog id with the entry', () => {
    const result = match('puley frente')
    expect(result.kind).toBe('dictionary')
    if (result.kind !== 'dictionary') return
    expect(result.entry.group).toBe('back')
    expect(result.entry.catalogId).not.toBeNull()
  })

  it('ignores equipment words the sheet left out', () => {
    // Only the barbell entry spells the name without equipment, so the exact match is unique.
    expect(keyOf(match('Crucifixo inverso'))).toBe('dumbbell_reverse_fly')
    // A typo still prefers the spelling that needs no equipment word (the default variant)...
    expect(keyOf(match('supino inclinad'))).toBe('barbell_incline_press')
    expect(keyOf(match('supino inclinad halteres'))).toBe('dumbbell_incline_press')
    expect(match('supino inclinad').confidence).toBe('high')
  })

  it('is low when two entries score the same', () => {
    // "puxada na polia" (cable) and "puxada articulada" (machine) both need an equipment word the sheet left out.
    const result = match('puxada')
    expect(result.kind).toBe('dictionary')
    expect(result.confidence).toBe('low')
  })

  it('is low when the sheet name has words the entry does not', () => {
    const result = match('Remada baixa unilateral')
    expect(keyOf(result)).toBe('cable_seated_row')
    expect(result.confidence).toBe('low')
  })

  it('is low when the sheet names another equipment', () => {
    const result = match('Cadeira flexora no smith')
    expect(keyOf(result)).toBe('seated_leg_curl')
    expect(result.confidence).toBe('low')
  })

  it('does not fuzz short words', () => {
    expect(match('pek dek').kind).toBe('none')
  })

  it('returns none for unknown or empty names', () => {
    expect(match('Exercício inventado qualquer')).toEqual({ kind: 'none', confidence: 'low' })
    expect(match('(aquecimento) 3x15')).toEqual({ kind: 'none', confidence: 'low' })
  })
})

describe('matchExercise (user exercises)', () => {
  const user: UserExercise[] = [
    { id: 'ex-1', name: 'Puxada alta aberta na polia', aliases: ['puley frente'] },
    { id: 'ex-2', name: 'Agachamento caseiro no degrau', aliases: [] },
  ]

  it('prefers the user exercise over the dictionary', () => {
    expect(match('Puley frente', user)).toEqual({ kind: 'user', exerciseId: 'ex-1', confidence: 'high' })
  })

  it('matches by normalized name', () => {
    expect(match('agachamento caseiro degrau (livre)', user)).toEqual({ kind: 'user', exerciseId: 'ex-2', confidence: 'high' })
  })

  it('falls back to the dictionary when no user exercise matches', () => {
    expect(keyOf(match('pulley frente', user))).toBe('lat_pulldown')
  })

  it('works with another dictionary', () => {
    const tiny: DictionaryEntry[] = [
      { key: 'foo_press', name: 'Prensa foo', aliases: ['foo'], group: 'chest', equipment: 'machine', catalogId: null, catalogName: null },
    ]
    const result = matchExercise('prensa fooo', { userExercises: [], dictionary: tiny })
    expect(result.kind).toBe('none') // "fooo" vs "foo": too short to fuzz
    expect(keyOf(matchExercise('prensaa foo', { userExercises: [], dictionary: tiny }))).toBe('foo_press')
  })
})
