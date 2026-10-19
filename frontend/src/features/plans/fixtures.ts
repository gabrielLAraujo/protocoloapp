import type { components } from '../../api/schema'

export type PlanVersion = components['schemas']['PlanVersionResponse']

export const PLAN_ID = '7d1f2a10-0000-5000-8000-0000000000b1'
export const FILE_ID = '7d1f2a10-0000-5000-8000-0000000000f1'
export const ACTIVE_ID = '7d1f2a10-0000-5000-8000-0000000000b0'

export const workoutDocument = () => ({
  rotation: { type: 'sequence', items: ['a', 'b', 'off'] },
  days: [
    {
      key: 'a',
      name: 'Treino A',
      exercises: [
        { key: 'e1', name: 'Supino reto', sets: [{ repsMin: 8, repsMax: 10 }], restSeconds: 90 },
        { key: 'e2', name: 'Crucifixo novo', sets: [{ repsMin: 10, repsMax: 12 }] },
      ],
    },
    { key: 'b', name: 'Treino B', exercises: [{ key: 'e1', name: 'Agachamento', sets: [{ repsMin: 6, repsMax: 8 }] }] },
  ],
})

export const protocolDocument = () => ({
  phaseName: 'Fase 2',
  updateDate: '2026-11-20',
  meals: [{ key: 'm1', label: 'Café da manhã', items: [{ food: 'Ovos', grams: 120, alternatives: [] }] }],
  items: [{ key: 'i1', category: 'supplement', name: 'Creatina', doseText: '5 g', timing: 'any', schedule: { type: 'daily' } }],
  cardio: { sessionsPerWeek: 3, durationMin: 30 },
  guidelines: [{ kind: 'water_min_l', value: 3 }],
})

export const planVersion = (overrides: Partial<PlanVersion> = {}): PlanVersion => ({
  id: PLAN_ID,
  kind: 'workout',
  status: 'draft',
  document: workoutDocument(),
  lowConfidence: [],
  extractionError: null,
  newExercises: [],
  diff: null,
  activatedAt: null,
  sourceFileId: FILE_ID,
  ...overrides,
})
