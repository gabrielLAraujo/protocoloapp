import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const WORKOUT_SESSION_ENTITY = 'workout_session'
export const SET_LOG_ENTITY = 'set_log'
export const EXERCISE_CHANGE_ENTITY = 'exercise_change'

export type SetKind = 'normal' | 'drop' | 'partial' | 'rest_pause' | 'warmup'
export type ExerciseChangeAction = 'swapped' | 'skipped'
/** Where a session was recorded: in this app or imported from Hevy (set by the server). */
export type SessionSource = 'app' | 'hevy'

export interface SessionLocal {
  id: string
  /** yyyy-MM-dd, the device's calendar day. */
  date: string
  planVersionId: string
  dayKey: string
  startedAt: string
  /** Null while the session is open. */
  endedAt: string | null
  note: string | null
  /** Per-exercise notes: planned exercise key -> text. Empty when there are none. */
  exerciseNotes: Record<string, string>
  clientUpdatedAt: string
  /** Set by the server (pull only); a session without a known source is from the app. */
  source: SessionSource
  /** The workout's title in Hevy; null for app sessions. Pull only. */
  externalTitle: string | null
}

export interface SessionSummary {
  session: SessionLocal
  setCount: number
  /** Σ weight × reps of the working sets. */
  volume: number
}

export interface SetLocal {
  id: string
  sessionId: string
  exerciseId: string
  /** Key of the planned exercise this set belongs to; null for an exercise added on the spot. */
  plannedExerciseKey: string | null
  setIndex: number
  weightKg: number
  reps: number
  kind: SetKind
  parentSetId: string | null
  completedAt: string
  clientUpdatedAt: string
  /** 1–10 in steps of 0.5; null when not recorded. */
  rpe: number | null
}

export interface ExerciseChangeLocal {
  id: string
  sessionId: string
  plannedExerciseKey: string
  action: ExerciseChangeAction
  replacementExerciseId: string | null
  note: string | null
  clientUpdatedAt: string
}

/**
 * The server's payloads (snake_case), see WorkoutPayloads.cs on the API. Sessions, sets and changes reach the device by
 * pull only (the Hevy import, or older sessions recorded in the app); the device pushes only their deletes.
 */
interface SessionPayload {
  date: string
  plan_version_id: string
  workout_day_key: string
  started_at: string
  ended_at: string | null
  note: string | null
  /** planned exercise key -> text; null/absent when there are none. */
  notes?: Record<string, string> | null
}

type PulledSessionPayload = SessionPayload & { source?: string | null; external_title?: string | null }

interface SetPayload {
  session_id: string
  exercise_id: string
  planned_exercise_key: string | null
  set_index: number
  weight_kg: number
  reps: number
  kind: SetKind
  parent_set_id: string | null
  completed_at: string
  /** 1–10 in steps of 0.5; absent from older servers. */
  rpe: number | null
}

interface ChangePayload {
  session_id: string
  planned_exercise_key: string
  action: ExerciseChangeAction
  replacement_exercise_id: string | null
  note: string | null
}

type SessionRow = Omit<SessionPayload, 'notes'> & {
  id: string
  exercise_notes: string | null
  client_updated_at: string
  deleted_at: string | null
  source: SessionSource
  external_title: string | null
}
type SetRow = SetPayload & { id: string; client_updated_at: string; deleted_at: string | null }
type ChangeRow = ChangePayload & { id: string; client_updated_at: string; deleted_at: string | null }

const iso = (value: string) => new Date(value).toISOString()

const parseNotes = (json: string | null): Record<string, string> => {
  if (json === null) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const notesJson = (notes: Record<string, string> | null | undefined): string | null =>
  notes && Object.keys(notes).length > 0 ? JSON.stringify(notes) : null

const toSession = (r: SessionRow): SessionLocal => ({
  id: r.id,
  date: r.date,
  planVersionId: r.plan_version_id,
  dayKey: r.workout_day_key,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  note: r.note,
  exerciseNotes: parseNotes(r.exercise_notes),
  clientUpdatedAt: r.client_updated_at,
  source: r.source === 'hevy' ? 'hevy' : 'app',
  externalTitle: r.external_title,
})

const toSet = (r: SetRow): SetLocal => ({
  id: r.id,
  sessionId: r.session_id,
  exerciseId: r.exercise_id,
  plannedExerciseKey: r.planned_exercise_key,
  setIndex: r.set_index,
  weightKg: r.weight_kg,
  reps: r.reps,
  kind: r.kind,
  parentSetId: r.parent_set_id,
  completedAt: r.completed_at,
  clientUpdatedAt: r.client_updated_at,
  rpe: r.rpe,
})

const toChange = (r: ChangeRow): ExerciseChangeLocal => ({
  id: r.id,
  sessionId: r.session_id,
  plannedExerciseKey: r.planned_exercise_key,
  action: r.action,
  replacementExerciseId: r.replacement_exercise_id,
  note: r.note,
  clientUpdatedAt: r.client_updated_at,
})

/** Where the session came from, as the server says it (pull only). */
interface SessionOrigin {
  source: SessionSource
  externalTitle: string | null
}

/** Stores a pulled session with the origin the server gave it. */
async function writeSession(db: LocalDb, id: string, p: SessionPayload, clientUpdatedAt: string, version: number, origin: SessionOrigin) {
  await db.execute(
    `INSERT INTO workout_sessions (id, date, plan_version_id, workout_day_key, started_at, ended_at, note, exercise_notes, client_updated_at, version, deleted_at, source, external_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, plan_version_id = excluded.plan_version_id, workout_day_key = excluded.workout_day_key,
       started_at = excluded.started_at, ended_at = excluded.ended_at, note = excluded.note, exercise_notes = excluded.exercise_notes,
       client_updated_at = excluded.client_updated_at, version = excluded.version, deleted_at = NULL,
       source = excluded.source, external_title = excluded.external_title`,
    [
      id, p.date, p.plan_version_id, p.workout_day_key, p.started_at, p.ended_at, p.note, notesJson(p.notes), clientUpdatedAt, version,
      origin.source, origin.externalTitle,
    ],
  )
}

async function writeSet(db: LocalDb, id: string, p: SetPayload, clientUpdatedAt: string, version: number) {
  await db.execute(
    `INSERT INTO set_logs (id, session_id, exercise_id, planned_exercise_key, set_index, weight_kg, reps, kind, parent_set_id, completed_at, client_updated_at, version, deleted_at, rpe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (id) DO UPDATE SET
       session_id = excluded.session_id, exercise_id = excluded.exercise_id, planned_exercise_key = excluded.planned_exercise_key,
       set_index = excluded.set_index, weight_kg = excluded.weight_kg, reps = excluded.reps, kind = excluded.kind,
       parent_set_id = excluded.parent_set_id, completed_at = excluded.completed_at, rpe = excluded.rpe,
       client_updated_at = excluded.client_updated_at, version = excluded.version, deleted_at = NULL`,
    [id, p.session_id, p.exercise_id, p.planned_exercise_key, p.set_index, p.weight_kg, p.reps, p.kind, p.parent_set_id, p.completed_at, clientUpdatedAt, version, p.rpe],
  )
}

async function writeChange(db: LocalDb, id: string, p: ChangePayload, clientUpdatedAt: string, version: number) {
  await db.execute(
    `INSERT INTO exercise_changes (id, session_id, planned_exercise_key, action, replacement_exercise_id, note, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       session_id = excluded.session_id, planned_exercise_key = excluded.planned_exercise_key, action = excluded.action,
       replacement_exercise_id = excluded.replacement_exercise_id, note = excluded.note,
       client_updated_at = excluded.client_updated_at, version = excluded.version, deleted_at = NULL`,
    [id, p.session_id, p.planned_exercise_key, p.action, p.replacement_exercise_id, p.note, clientUpdatedAt, version],
  )
}

/** Soft-deletes the live sub-sets of a set and queues their deletes (a sub-set never outlives its parent). */
async function deleteChildren(tx: LocalDb, parentId: string, now: Date) {
  const children = await tx.query<SetRow>('SELECT * FROM set_logs WHERE parent_set_id = ? AND deleted_at IS NULL', [parentId])
  for (const child of children) {
    const at = nextClientUpdatedAt(now, child.client_updated_at)
    await tx.execute('UPDATE set_logs SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [at, at, child.id])
    await outbox.enqueue(tx, { entity: SET_LOG_ENTITY, id: child.id, op: 'delete', payload: null, clientUpdatedAt: at })
  }
}

/**
 * Reads the workout records and deletes them. Every delete hides the row (soft delete, like the server) and queues it in
 * one transaction. Nothing else is written locally: sessions, sets and changes come from the server (see the payloads).
 */
export const workoutRepo = {
  /**
   * Discards a session that has no live sets (soft delete, like the server) and queues the delete. No-op when it is already
   * gone; refuses a session with sets, which are never dropped silently.
   */
  async deleteSession(db: LocalDb, _userId: string, sessionId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<SessionRow>('SELECT * FROM workout_sessions WHERE id = ?', [sessionId])
      if (!row || row.deleted_at !== null) return
      const [count] = await tx.query<{ n: number }>('SELECT COUNT(*) AS n FROM set_logs WHERE session_id = ? AND deleted_at IS NULL', [sessionId])
      if (Number(count?.n ?? 0) > 0) throw new Error('The session has sets.')
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE workout_sessions SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, sessionId])
      await outbox.enqueue(tx, { entity: WORKOUT_SESSION_ENTITY, id: sessionId, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  /** A live session by id, or null. */
  async sessionById(db: LocalDb, id: string): Promise<SessionLocal | null> {
    const [row] = await db.query<SessionRow>('SELECT * FROM workout_sessions WHERE id = ? AND deleted_at IS NULL', [id])
    return row ? toSession(row) : null
  },

  /** Live sessions with `from <= date <= to` (yyyy-MM-dd), oldest first. */
  async sessionsBetween(db: LocalDb, from: string, to: string): Promise<SessionLocal[]> {
    const rows = await db.query<SessionRow>(
      'SELECT * FROM workout_sessions WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, started_at',
      [from, to],
    )
    return rows.map(toSession)
  },

  /**
   * Dates in `[from, to]` with a live session, finished or not, holding at least one live working (non-warm-up) set: the days a
   * workout counts as done (same rule as Hoje). One query.
   */
  async workedOutDates(db: LocalDb, from: string, to: string): Promise<string[]> {
    const rows = await db.query<{ date: string }>(
      `SELECT DISTINCT s.date AS date FROM workout_sessions s
       JOIN set_logs l ON l.session_id = s.id AND l.deleted_at IS NULL AND l.kind <> 'warmup'
       WHERE s.date >= ? AND s.date <= ? AND s.deleted_at IS NULL
       ORDER BY s.date`,
      [from, to],
    )
    return rows.map((r) => r.date)
  },

  /**
   * Deletes the set (soft, like the server) and queues the delete. No-op when it is already gone. Its sub-sets (drops,
   * rest-pauses) go with it, queued first: a sub-set never outlives its parent (the server refuses one whose parent is gone).
   */
  async deleteSet(db: LocalDb, _userId: string, setId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<SetRow>('SELECT * FROM set_logs WHERE id = ?', [setId])
      if (!row || row.deleted_at !== null) return
      await deleteChildren(tx, setId, now)
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE set_logs SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, setId])
      await outbox.enqueue(tx, { entity: SET_LOG_ENTITY, id: setId, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  /** Undoes a change (soft delete, like the server): the planned exercise is back as planned. No-op when it is already gone. */
  async removeChange(db: LocalDb, _userId: string, changeId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<ChangeRow>('SELECT * FROM exercise_changes WHERE id = ?', [changeId])
      if (!row || row.deleted_at !== null) return
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE exercise_changes SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, changeId])
      await outbox.enqueue(tx, { entity: EXERCISE_CHANGE_ENTITY, id: changeId, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  async changesForSession(db: LocalDb, sessionId: string): Promise<ExerciseChangeLocal[]> {
    const rows = await db.query<ChangeRow>(
      'SELECT * FROM exercise_changes WHERE session_id = ? AND deleted_at IS NULL ORDER BY client_updated_at, rowid',
      [sessionId],
    )
    return rows.map(toChange)
  },

  /** The session's live sets in the order they were done. */
  async setsForSession(db: LocalDb, sessionId: string): Promise<SetLocal[]> {
    const rows = await db.query<SetRow>(
      'SELECT * FROM set_logs WHERE session_id = ? AND deleted_at IS NULL ORDER BY completed_at, set_index, id',
      [sessionId],
    )
    return rows.map(toSet)
  },

  /**
   * Sessions newest first with their live set count (main sets only: drops and rest-pauses are part of their set) and volume (warm-ups excluded), in one query. `limit`/`offset` page it.
   */
  async sessionSummaries(db: LocalDb, limit: number, offset: number): Promise<SessionSummary[]> {
    const rows = await db.query<SessionRow & { set_count: number; volume: number }>(
      `SELECT s.*, COUNT(CASE WHEN l.parent_set_id IS NULL THEN l.id END) AS set_count,
              COALESCE(SUM(CASE WHEN l.kind <> 'warmup' THEN l.weight_kg * l.reps ELSE 0 END), 0) AS volume
       FROM workout_sessions s
       LEFT JOIN set_logs l ON l.session_id = s.id AND l.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
       GROUP BY s.id
       ORDER BY s.date DESC, s.started_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    )
    return rows.map((r) => ({ session: toSession(r), setCount: Number(r.set_count), volume: Number(r.volume) }))
  },

  /** Ids of the exercises that have at least one live set in a live session. */
  async exerciseIdsWithSets(db: LocalDb): Promise<string[]> {
    const rows = await db.query<{ exercise_id: string }>(
      `SELECT DISTINCT l.exercise_id FROM set_logs l
       WHERE l.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM workout_sessions s WHERE s.id = l.session_id AND s.deleted_at IS NOT NULL)`,
    )
    return rows.map((r) => r.exercise_id)
  },

  /** The latest `limit` live sets of an exercise across live sessions, newest first. */
  async setsForExercise(db: LocalDb, exerciseId: string, limit: number): Promise<SetLocal[]> {
    const rows = await db.query<SetRow>(
      `SELECT * FROM set_logs WHERE exercise_id = ? AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM workout_sessions s WHERE s.id = set_logs.session_id AND s.deleted_at IS NOT NULL)
       ORDER BY completed_at DESC, set_index DESC, id LIMIT ?`,
      [exerciseId, limit],
    )
    return rows.map(toSet)
  },
}

export const workoutSessionSync: SyncEntityAdapter = {
  entity: WORKOUT_SESSION_ENTITY,
  table: 'workout_sessions',
  applyRemote: (db, record) =>
    applyPulled(db, WORKOUT_SESSION_ENTITY, 'workout_sessions', record, async (payload, clientUpdatedAt) => {
      const { source, external_title, ...p } = payload as PulledSessionPayload
      await writeSession(
        db,
        record.id,
        { ...p, ended_at: p.ended_at === null ? null : iso(p.ended_at), started_at: iso(p.started_at), note: p.note ?? null, notes: p.notes ?? null },
        clientUpdatedAt,
        record.version,
        { source: source === 'hevy' ? 'hevy' : 'app', externalTitle: external_title ?? null },
      )
    }),
}

export const setLogSync: SyncEntityAdapter = {
  entity: SET_LOG_ENTITY,
  table: 'set_logs',
  applyRemote: async (db, record) => {
    await applyPulled(db, SET_LOG_ENTITY, 'set_logs', record, async (payload, clientUpdatedAt) => {
      const p = payload as SetPayload
      await writeSet(
        db,
        record.id,
        { ...p, planned_exercise_key: p.planned_exercise_key ?? null, parent_set_id: p.parent_set_id ?? null, completed_at: iso(p.completed_at), rpe: p.rpe ?? null },
        clientUpdatedAt,
        record.version,
      )
    })
    // A set deleted on another device takes the sub-sets this device made under it along (the server refuses them anyway).
    if (record.deletedAt !== null || record.payload === null) await deleteChildren(db, record.id, new Date())
  },
}

export const exerciseChangeSync: SyncEntityAdapter = {
  entity: EXERCISE_CHANGE_ENTITY,
  table: 'exercise_changes',
  applyRemote: (db, record) =>
    applyPulled(db, EXERCISE_CHANGE_ENTITY, 'exercise_changes', record, async (payload, clientUpdatedAt) => {
      const p = payload as ChangePayload
      await writeChange(db, record.id, { ...p, replacement_exercise_id: p.replacement_exercise_id ?? null, note: p.note ?? null }, clientUpdatedAt, record.version)
    }),
}
