import { describe, expect, it } from 'vitest'
import { parseProtocolDocument, parseWorkoutDocument } from './planDocuments'

const protocol = {
  phaseName: 'Fase Exemplo',
  updateDate: '2026-12-01',
  billingDate: '2026-11-25',
  meals: [
    {
      key: 'meal1',
      label: 'Refeição 1',
      items: [{ food: 'Arroz exemplo', grams: 150, alternatives: ['Batata exemplo'] }, { food: 'Ovos exemplo' }],
      notes: 'Exemplo',
    },
  ],
  items: [
    { key: 'sup1', category: 'supplement', name: 'Suplemento A', doseText: '5 g', timing: 'post_workout', schedule: { type: 'daily' } },
    { key: 'sup2', category: 'supplement', name: 'Suplemento B', timing: 'with_meal:meal1', schedule: { type: 'weekdays', days: ['mon', 'thu'] } },
    { key: 'sup3', category: 'compound', name: 'Composto C', schedule: { type: 'every_n_days', n: 3, anchor: '2026-10-20' } },
  ],
  cardio: { sessionsPerWeek: 4, daily: false, durationMin: 30, intensity: 'leve', preferredTime: 'jejum' },
  guidelines: [{ kind: 'water_min_l', value: 4 }, { kind: 'text', text: 'Dormir bem' }],
  trainingSplitNote: 'Exemplo',
}

const workout = {
  rotation: { type: 'sequence', items: ['A', 'B', 'off'], anchor: '2026-10-20' },
  days: [
    {
      key: 'A',
      name: 'Treino A',
      notes: 'Exemplo',
      exercises: [
        {
          key: 'a1',
          exerciseId: '3f2b8c1e-5d7a-4b9e-8f10-1a2b3c4d5e6f',
          name: 'Supino exemplo',
          sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8, technique: 'drop' }],
          restSeconds: 90,
          restSequence: [40, 25, 10],
          technique: 'SST',
          supersetWith: 'a2',
        },
        { key: 'a2', name: 'Crucifixo exemplo', sets: [{ repsMin: 10, repsMax: 12 }] },
      ],
    },
  ],
}

describe('parseProtocolDocument', () => {
  it('parses a full document', () => {
    const r = parseProtocolDocument(protocol)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.updateDate).toBe('2026-12-01')
      expect(r.value.items[2].schedule.anchor).toBe('2026-10-20')
      expect(r.value.cardio?.daily).toBe(false)
      expect(r.value.meals[0].items[1].alternatives).toEqual([])
    }
  })

  it('is lenient: missing lists are empty, unknown keys are ignored, nulls allowed', () => {
    const r = parseProtocolDocument({ updateDate: null, whatever: 1, items: [{ key: 'x', name: 'N', category: 'supplement' }] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.meals).toEqual([])
      expect(r.value.items[0].timing).toBe('any')
      expect(r.value.items[0].schedule.type).toBe('daily')
    }
  })

  it('reports paths for wrong types and bad dates', () => {
    const r = parseProtocolDocument({ updateDate: '2026-02-30', meals: [{ key: 1 }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith('updateDate'))).toBe(true)
      expect(r.errors.some((e) => e.startsWith('meals.0.key'))).toBe(true)
    }
  })

  it('rejects a non-object root', () => {
    for (const raw of [null, 'x', [], 3]) expect(parseProtocolDocument(raw)).toEqual({ ok: false, errors: ['document'] })
  })
})

describe('parseWorkoutDocument', () => {
  it('parses a full document', () => {
    const r = parseWorkoutDocument(workout)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.rotation?.items).toEqual(['A', 'B', 'off'])
      expect(r.value.days[0].exercises[0].restSequence).toEqual([40, 25, 10])
      expect(r.value.days[0].exercises[0].supersetWith).toBe('a2')
    }
  })

  it('parses fixed_weekdays rotation', () => {
    const r = parseWorkoutDocument({ rotation: { type: 'fixed_weekdays', map: { mon: 'A', tue: 'off' } }, days: [] })
    expect(r.ok && r.value.rotation?.map).toEqual({ mon: 'A', tue: 'off' })
  })

  it('accepts a document without rotation', () => {
    const r = parseWorkoutDocument({})
    expect(r.ok && r.value.days).toEqual([])
  })

  it('reports paths for wrong types', () => {
    const r = parseWorkoutDocument({ days: [{ key: 'A', name: 'A', exercises: [{ key: 'k', name: 'n', sets: [{ repsMin: null }] }] }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('days.0.exercises.0.sets.0.repsMin')
  })

  it('rejects a bad exerciseId', () => {
    expect(parseWorkoutDocument({ days: [{ key: 'A', name: 'A', exercises: [{ key: 'k', name: 'n', exerciseId: 'nope' }] }] }).ok).toBe(false)
  })
})

describe('null tolerance (backend reads null strings leniently)', () => {
  it('protocol: null strings become defaults', () => {
    const r = parseProtocolDocument({
      meals: [{ key: null, label: null, items: [{ food: null, alternatives: null }] }],
      items: [{ key: null, category: null, name: null, timing: null, schedule: { type: null } }],
      guidelines: [{ kind: null }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.meals[0].label).toBe('')
      expect(r.value.items[0].timing).toBe('any')
      expect(r.value.items[0].schedule.type).toBe('daily')
    }
  })

  it('workout: null strings become defaults', () => {
    const r = parseWorkoutDocument({ rotation: { type: null }, days: [{ key: null, name: null, exercises: [{ key: null, name: null, sets: null }] }] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.rotation?.type).toBe('')
      expect(r.value.days[0].name).toBe('')
      expect(r.value.days[0].exercises[0].sets).toEqual([])
    }
  })
})

describe('workout techniques', () => {
  const withExercise = (exercise: Record<string, unknown>) => ({
    rotation: { type: 'sequence', items: ['A'] },
    days: [{ key: 'A', name: 'Treino A', exercises: [{ key: 'a1', name: 'Movimento fictício', sets: [{ repsMin: 8, repsMax: 10 }], ...exercise }] }],
  })

  it('accepts every technique type and the drops / restPause set fields', () => {
    const base = withExercise({
        sets: [{ repsMin: 8, repsMax: 10, drops: 2, restPause: 1 }, { repsMin: 8, repsMax: 10 }, { repsMin: 8, repsMax: 10 }],
        techniques: [
          { type: 'drop', count: 2, sets: 'last' },
          { type: 'drop', count: 1, sets: [0, 2] },
          { type: 'rest_pause', count: 1 },
          { type: 'biset', with: 'a2' },
          { type: 'sst', rests: [40, 20] },
          { type: 'peak', seconds: 3 },
          { type: 'isometric', seconds: 20 },
          { type: 'partials' },
          { type: 'partials', reps: 6 },
          { type: 'zero_point', seconds: 2 },
          { type: 'progressive_load' },
          { type: 'stretch_interval' },
        ],
    })
    base.days[0].exercises.push({ key: 'a2', name: 'Outro fictício', sets: [{ repsMin: 8, repsMax: 10 }] } as never)
    const result = parseWorkoutDocument(base)
    expect(result.ok).toBe(true)
  })

  it('keeps old documents without the fields valid', () => {
    expect(parseWorkoutDocument(withExercise({})).ok).toBe(true)
    expect(parseWorkoutDocument(withExercise({ techniques: null, sets: [{ repsMin: 8, repsMax: 10, drops: null }] })).ok).toBe(true)
  })

  it.each([
    [{ type: 'drop', count: 6, sets: 'last' }],
    [{ type: 'drop', count: 0, sets: 'last' }],
    [{ type: 'drop', count: 1, sets: 'first' }],
    [{ type: 'rest_pause', count: 6 }],
    [{ type: 'peak', seconds: 11 }],
    [{ type: 'isometric', seconds: 121 }],
    [{ type: 'partials', reps: 31 }],
    [{ type: 'zero_point', seconds: 0 }],
    [{ type: 'biset' }],
  ])('rejects %j with a path-keyed error', (technique) => {
    const result = parseWorkoutDocument(withExercise({ techniques: [technique] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/^days\.0\.exercises\.0\.techniques\.0/)
  })

  it('drops an unknown technique type and keeps the document and the known techniques', () => {
    const result = parseWorkoutDocument(withExercise({ techniques: [{ type: 'laser', x: 1 }, { type: 'peak', seconds: 3 }] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.days[0].exercises[0].techniques).toEqual([{ type: 'peak', seconds: 3 }])
  })

  it.each([
    [{ techniques: [{ type: 'sst', rests: [] }] }, 'techniques.0'],
    [{ techniques: [{ type: 'sst', rests: [901] }] }, 'techniques.0'],
    [{ techniques: [{ type: 'drop', count: 1, sets: [1] }] }, 'techniques.0.sets'],
    [{ techniques: [{ type: 'biset', with: 'zz' }] }, 'techniques.0.with'],
    [{ techniques: [{ type: 'biset', with: 'a1' }] }, 'techniques.0.with'],
  ])('applies the server rules: %j', (exercise, path) => {
    const result = parseWorkoutDocument(withExercise(exercise))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('|')).toContain(path)
  })

  it('rejects drops / restPause outside 0–5', () => {
    expect(parseWorkoutDocument(withExercise({ sets: [{ repsMin: 8, repsMax: 10, drops: 6 }] })).ok).toBe(false)
    expect(parseWorkoutDocument(withExercise({ sets: [{ repsMin: 8, repsMax: 10, restPause: -1 }] })).ok).toBe(false)
  })
})
