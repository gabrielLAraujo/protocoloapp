import type { SyncRecord } from '../data/apiClient'
import { newId } from '../data/ids'
import type { LocalDb } from '../data/localDb'
import {
  EXERCISE_CHANGE_ENTITY,
  exerciseChangeSync,
  SET_LOG_ENTITY,
  setLogSync,
  WORKOUT_SESSION_ENTITY,
  workoutSessionSync,
  type ExerciseChangeAction,
  type SessionSource,
  type SetKind,
} from '../data/workoutRepo'

/**
 * Test helpers that store workout sessions, sets and exercise changes the way they reach the device now: pulled from the
 * server (the Hevy import or an older app session), through the sync adapters. Nothing is queued in the outbox.
 */

const record = (entity: string, id: string, payload: unknown, at: Date, version: number): SyncRecord => ({
  entity,
  id,
  version,
  payload: payload as SyncRecord['payload'],
  deletedAt: null,
  clientUpdatedAt: at.toISOString(),
})

export interface SeedSessionInput {
  id?: string
  /** yyyy-MM-dd. */
  date: string
  planVersionId: string
  dayKey: string
  startedAt: Date
  /** One hour after `startedAt` when omitted; null for a session never finished. */
  endedAt?: Date | null
  source?: SessionSource
  externalTitle?: string | null
  note?: string | null
  exerciseNotes?: Record<string, string> | null
  /** The server version; a later seed of the same id needs a higher one. */
  version?: number
}

/** Stores a session as a pull would and returns its id. */
export async function seedSession(db: LocalDb, input: SeedSessionInput): Promise<string> {
  const id = input.id ?? newId()
  const endedAt = input.endedAt === undefined ? new Date(input.startedAt.getTime() + 3_600_000) : input.endedAt
  await workoutSessionSync.applyRemote(
    db,
    record(
      WORKOUT_SESSION_ENTITY,
      id,
      {
        date: input.date,
        plan_version_id: input.planVersionId,
        workout_day_key: input.dayKey,
        started_at: input.startedAt.toISOString(),
        ended_at: endedAt === null ? null : endedAt.toISOString(),
        note: input.note ?? null,
        notes: input.exerciseNotes ?? null,
        source: input.source ?? 'app',
        external_title: input.externalTitle ?? null,
      },
      input.startedAt,
      input.version ?? 1,
    ),
  )
  return id
}

export interface SeedSetInput {
  id?: string
  sessionId: string
  exerciseId: string
  plannedExerciseKey: string | null
  setIndex: number
  weightKg: number
  reps: number
  kind?: SetKind
  parentSetId?: string | null
  completedAt: Date
  rpe?: number | null
}

/** Stores a set as a pull would and returns its id. */
export async function seedSet(db: LocalDb, input: SeedSetInput): Promise<string> {
  const id = input.id ?? newId()
  await setLogSync.applyRemote(
    db,
    record(
      SET_LOG_ENTITY,
      id,
      {
        session_id: input.sessionId,
        exercise_id: input.exerciseId,
        planned_exercise_key: input.plannedExerciseKey,
        set_index: input.setIndex,
        weight_kg: input.weightKg,
        reps: input.reps,
        kind: input.kind ?? 'normal',
        parent_set_id: input.parentSetId ?? null,
        completed_at: input.completedAt.toISOString(),
        rpe: input.rpe ?? null,
      },
      input.completedAt,
      1,
    ),
  )
  return id
}

export interface SeedChangeInput {
  id?: string
  sessionId: string
  plannedExerciseKey: string
  action: ExerciseChangeAction
  replacementExerciseId?: string | null
  note?: string | null
  at: Date
}

/** Stores an exercise change (swap or skip) as a pull would and returns its id. */
export async function seedChange(db: LocalDb, input: SeedChangeInput): Promise<string> {
  const id = input.id ?? newId()
  await exerciseChangeSync.applyRemote(
    db,
    record(
      EXERCISE_CHANGE_ENTITY,
      id,
      {
        session_id: input.sessionId,
        planned_exercise_key: input.plannedExerciseKey,
        action: input.action,
        replacement_exercise_id: input.replacementExerciseId ?? null,
        note: input.note ?? null,
      },
      input.at,
      1,
    ),
  )
  return id
}
