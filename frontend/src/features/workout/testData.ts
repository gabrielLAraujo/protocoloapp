import type { SyncRecord } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { exerciseSync } from '../../data/exerciseRepo'
import { planVersionSync } from '../../data/planRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { USER_A } from '../../test/localDb'

/** Fictitious fixtures for the workout screens' tests. */
export const BENCH = '7d1f2a10-0000-5000-8000-0000000000e1'
export const FLY = '7d1f2a10-0000-5000-8000-0000000000e2'
export const SQUAT = '7d1f2a10-0000-5000-8000-0000000000e3'
export const PLAN = '7d1f2a10-0000-5000-8000-0000000000c1'

const record = (entity: string, id: string, payload: unknown): SyncRecord => ({
  entity,
  id,
  version: 1,
  payload: payload as SyncRecord['payload'],
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

export async function seedExercises(db: LocalDb) {
  const rows = [
    [BENCH, 'Supino reto', 'supino reto', 'chest'],
    [FLY, 'Crucifixo', 'crucifixo', 'chest'],
    [SQUAT, 'Agachamento', 'agachamento', 'quads'],
  ] as const
  for (const [id, name, normalized, group] of rows) {
    await exerciseSync.applyRemote(db, record('exercise', id, { name, normalized_name: normalized, primary_muscle_group: group, aliases: [] }))
  }
}

export const workoutDoc = (items: string[]) => ({
  rotation: { type: 'sequence', items, anchor: '2026-10-18' },
  days: [
    {
      key: 'a',
      name: 'Treino A',
      notes: 'Peito',
      exercises: [
        { key: 'e1', exerciseId: BENCH, name: 'Supino reto', sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8, technique: 'drop' }], restSeconds: 90 },
        { key: 'e2', exerciseId: FLY, name: 'Crucifixo', sets: [{ repsMin: 12, repsMax: 15 }] },
      ],
    },
    { key: 'b', name: 'Treino B', notes: 'Pernas', exercises: [{ key: 'e1', exerciseId: SQUAT, name: 'Agachamento', sets: [{ repsMin: 6, repsMax: 8 }] }] },
  ],
})

/** An active workout plan, activated at local noon of 2026-10-10. */
export async function seedPlan(db: LocalDb, items: string[], id = PLAN) {
  await planVersionSync.applyRemote(
    db,
    record('plan_version', id, {
      kind: 'workout',
      status: 'active',
      document: workoutDoc(items),
      activated_at: new Date(2026, 9, 10, 12).toISOString(),
      low_confidence: [],
    }),
  )
}

/** A finished session in the past with the given sets of one exercise: [weight, reps][]. */
export async function seedPastSession(db: LocalDb, date: string, exerciseId: string, sets: [number, number][], plannedKey = 'e1') {
  const start = new Date(`${date}T12:00:00`)
  const sessionId = await workoutRepo.startSession(db, USER_A, { date, planVersionId: PLAN, dayKey: 'a' }, start)
  for (const [i, [weightKg, reps]] of sets.entries()) {
    await workoutRepo.logSet(
      db,
      USER_A,
      { sessionId, exerciseId, plannedExerciseKey: plannedKey, setIndex: i, weightKg, reps, kind: 'normal' },
      new Date(start.getTime() + (i + 1) * 60_000),
    )
  }
  await workoutRepo.finishSession(db, USER_A, sessionId, new Date(start.getTime() + 3_600_000))
  return sessionId
}
