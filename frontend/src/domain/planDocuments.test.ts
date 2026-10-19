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
          restSequence: [45, 30, 15],
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
      expect(r.value.days[0].exercises[0].restSequence).toEqual([45, 30, 15])
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
