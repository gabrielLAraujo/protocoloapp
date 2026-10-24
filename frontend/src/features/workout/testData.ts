import type { SyncRecord } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { exerciseSync } from '../../data/exerciseRepo'
import { planVersionSync } from '../../data/planRepo'
import { setLogSync, workoutRepo, workoutSessionSync } from '../../data/workoutRepo'
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
export async function seedPlan(db: LocalDb, items: string[], id = PLAN, tweak?: (doc: ReturnType<typeof workoutDoc>) => void) {
  const document = workoutDoc(items)
  tweak?.(document)
  await planVersionSync.applyRemote(
    db,
    record('plan_version', id, {
      kind: 'workout',
      status: 'active',
      document,
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

/**
 * A finished session imported from Hevy (as the pull writes it), day `a` of PLAN, with the given sets of one exercise:
 * [weight, reps, rpe?][]; the sets are `${id}-0`, `${id}-1`…
 */
export async function seedHevySession(db: LocalDb, id: string, date: string, exerciseId: string, sets: [number, number, number?][], title = 'Treino de exemplo') {
  const start = `${date}T12:00:00.000Z`
  await workoutSessionSync.applyRemote(
    db,
    record('workout_session', id, {
      date,
      plan_version_id: PLAN,
      workout_day_key: 'a',
      started_at: start,
      ended_at: `${date}T13:00:00.000Z`,
      note: null,
      source: 'hevy',
      external_title: title,
    }),
  )
  for (const [i, [weight_kg, reps, rpe]] of sets.entries()) {
    await setLogSync.applyRemote(
      db,
      record('set_log', `${id}-${i}`, {
        session_id: id,
        exercise_id: exerciseId,
        planned_exercise_key: 'e1',
        set_index: i,
        weight_kg,
        reps,
        kind: 'normal',
        parent_set_id: null,
        completed_at: `${date}T12:0${i + 1}:00.000Z`,
        rpe: rpe ?? null,
      }),
    )
  }
  return id
}
