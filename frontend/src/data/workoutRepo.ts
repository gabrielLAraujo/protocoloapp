import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { newId } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const WORKOUT_SESSION_ENTITY = 'workout_session'
export const SET_LOG_ENTITY = 'set_log'
export const EXERCISE_CHANGE_ENTITY = 'exercise_change'

export type SetKind = 'normal' | 'drop' | 'partial' | 'rest_pause' | 'warmup'
export type ExerciseChangeAction = 'swapped' | 'skipped'

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
}

export const MAX_EXERCISE_NOTE_LENGTH = 2000
export const MAX_EXERCISE_NOTES = 30

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

export interface SetInput {
  sessionId: string
  exerciseId: string
  plannedExerciseKey: string | null
  /** 0–50. */
  setIndex: number
  /** 0–1000. */
  weightKg: number
  /** 0–200. */
  reps: number
  kind: SetKind
  parentSetId?: string | null
  /** When the set was done; `now` when omitted (a logged earlier day passes a time of that day). */
  completedAt?: Date
}

export type SetPatch = Partial<Pick<SetInput, 'weightKg' | 'reps' | 'kind' | 'setIndex'>>

export interface ExerciseChangeInput {
  sessionId: string
  plannedExerciseKey: string
  action: ExerciseChangeAction
  replacementExerciseId?: string | null
  note?: string | null
}

/** The server's payloads (snake_case), see WorkoutPayloads.cs on the API. */
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
}

interface ChangePayload {
  session_id: string
  planned_exercise_key: string
  action: ExerciseChangeAction
  replacement_exercise_id: string | null
  note: string | null
}

type SessionRow = Omit<SessionPayload, 'notes'> & { id: string; exercise_notes: string | null; client_updated_at: string; deleted_at: string | null }
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

/** The payload form of the notes: null instead of an empty object. */
const noteMap = (notes: Record<string, string>): Record<string, string> | null => (Object.keys(notes).length > 0 ? notes : null)

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

async function writeSession(db: LocalDb, id: string, p: SessionPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO workout_sessions (id, date, plan_version_id, workout_day_key, started_at, ended_at, note, exercise_notes, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, plan_version_id = excluded.plan_version_id, workout_day_key = excluded.workout_day_key,
       started_at = excluded.started_at, ended_at = excluded.ended_at, note = excluded.note, exercise_notes = excluded.exercise_notes,
       client_updated_at = excluded.client_updated_at, version = COALESCE(excluded.version, workout_sessions.version), deleted_at = NULL`,
    [id, p.date, p.plan_version_id, p.workout_day_key, p.started_at, p.ended_at, p.note, notesJson(p.notes), clientUpdatedAt, version],
  )
}

async function writeSet(db: LocalDb, id: string, p: SetPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO set_logs (id, session_id, exercise_id, planned_exercise_key, set_index, weight_kg, reps, kind, parent_set_id, completed_at, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       session_id = excluded.session_id, exercise_id = excluded.exercise_id, planned_exercise_key = excluded.planned_exercise_key,
       set_index = excluded.set_index, weight_kg = excluded.weight_kg, reps = excluded.reps, kind = excluded.kind,
       parent_set_id = excluded.parent_set_id, completed_at = excluded.completed_at,
       client_updated_at = excluded.client_updated_at, version = COALESCE(excluded.version, set_logs.version), deleted_at = NULL`,
    [id, p.session_id, p.exercise_id, p.planned_exercise_key, p.set_index, p.weight_kg, p.reps, p.kind, p.parent_set_id, p.completed_at, clientUpdatedAt, version],
  )
}

async function writeChange(db: LocalDb, id: string, p: ChangePayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO exercise_changes (id, session_id, planned_exercise_key, action, replacement_exercise_id, note, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       session_id = excluded.session_id, planned_exercise_key = excluded.planned_exercise_key, action = excluded.action,
       replacement_exercise_id = excluded.replacement_exercise_id, note = excluded.note,
       client_updated_at = excluded.client_updated_at, version = COALESCE(excluded.version, exercise_changes.version), deleted_at = NULL`,
    [id, p.session_id, p.planned_exercise_key, p.action, p.replacement_exercise_id, p.note, clientUpdatedAt, version],
  )
}

const sessionPayload = (r: SessionRow): SessionPayload => ({
  date: r.date,
  plan_version_id: r.plan_version_id,
  workout_day_key: r.workout_day_key,
  started_at: r.started_at,
  ended_at: r.ended_at,
  note: r.note,
  notes: noteMap(parseNotes(r.exercise_notes)),
})

const setPayload = (r: SetRow): SetPayload => ({
  session_id: r.session_id,
  exercise_id: r.exercise_id,
  planned_exercise_key: r.planned_exercise_key,
  set_index: r.set_index,
  weight_kg: r.weight_kg,
  reps: r.reps,
  kind: r.kind,
  parent_set_id: r.parent_set_id,
  completed_at: r.completed_at,
})

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
 * Every write stores the row and queues it in one transaction. The session is queued when it starts, so it always
 * precedes its sets in the outbox (the server requires the session to exist); later edits queue new entries after.
 */
export const workoutRepo = {
  /** Starts a session now (or at `startedAt`, for an earlier day logged afterwards) and returns its id. */
  async startSession(
    db: LocalDb,
    _userId: string,
    input: { date: string; planVersionId: string; dayKey: string; startedAt?: Date },
    now: Date,
  ): Promise<string> {
    const id = newId()
    const payload: SessionPayload = {
      date: input.date,
      plan_version_id: input.planVersionId,
      workout_day_key: input.dayKey,
      started_at: (input.startedAt ?? now).toISOString(),
      ended_at: null,
      note: null,
      notes: null,
    }
    const clientUpdatedAt = now.toISOString()
    await db.transaction(async (tx) => {
      await writeSession(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: WORKOUT_SESSION_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
    return id
  },

  /**
   * Sets (or, with a blank text, clears) the note of one planned exercise of the session and queues the session again.
   * The server takes at most 30 notes of 2000 characters each.
   */
  async setExerciseNote(db: LocalDb, _userId: string, sessionId: string, plannedExerciseKey: string, text: string, now: Date): Promise<void> {
    const value = text.trim()
    if (value.length > MAX_EXERCISE_NOTE_LENGTH) throw new Error('The note is too long.')
    await db.transaction(async (tx) => {
      const [row] = await tx.query<SessionRow>('SELECT * FROM workout_sessions WHERE id = ? AND deleted_at IS NULL', [sessionId])
      if (!row) throw new Error('Session not found.')
      const notes = parseNotes(row.exercise_notes)
      if (value === '') delete notes[plannedExerciseKey]
      else notes[plannedExerciseKey] = value
      if (Object.keys(notes).length > MAX_EXERCISE_NOTES) throw new Error('Too many exercise notes.')
      if ((notes[plannedExerciseKey] ?? '') === (parseNotes(row.exercise_notes)[plannedExerciseKey] ?? '')) return
      const payload: SessionPayload = { ...sessionPayload(row), notes: noteMap(notes) }
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await writeSession(tx, sessionId, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: WORKOUT_SESSION_ENTITY, id: sessionId, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
  },

  /** Ends the session now. No-op when it is already ended. */
  async finishSession(db: LocalDb, _userId: string, sessionId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<SessionRow>('SELECT * FROM workout_sessions WHERE id = ? AND deleted_at IS NULL', [sessionId])
      if (!row) throw new Error('Session not found.')
      if (row.ended_at !== null) return
      // The server requires ended_at >= started_at, even if the clock went backwards.
      const endedAt = new Date(Math.max(now.getTime(), Date.parse(row.started_at))).toISOString()
      const payload = { ...sessionPayload(row), ended_at: endedAt }
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await writeSession(tx, sessionId, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: WORKOUT_SESSION_ENTITY, id: sessionId, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
  },

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

  /** The session started and not yet finished (the newest one), or null. */
  async openSession(db: LocalDb): Promise<SessionLocal | null> {
    const [row] = await db.query<SessionRow>(
      'SELECT * FROM workout_sessions WHERE ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1',
    )
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
   * Dates in `[from, to]` with a finished live session holding at least one live working (non-warm-up) set: the days a
   * workout counts as done (same rule as Hoje). One query.
   */
  async workedOutDates(db: LocalDb, from: string, to: string): Promise<string[]> {
    const rows = await db.query<{ date: string }>(
      `SELECT DISTINCT s.date AS date FROM workout_sessions s
       JOIN set_logs l ON l.session_id = s.id AND l.deleted_at IS NULL AND l.kind <> 'warmup'
       WHERE s.date >= ? AND s.date <= ? AND s.deleted_at IS NULL AND s.ended_at IS NOT NULL
       ORDER BY s.date`,
      [from, to],
    )
    return rows.map((r) => r.date)
  },

  async logSet(db: LocalDb, _userId: string, input: SetInput, now: Date): Promise<string> {
    const id = newId()
    const payload: SetPayload = {
      session_id: input.sessionId,
      exercise_id: input.exerciseId,
      planned_exercise_key: input.plannedExerciseKey,
      set_index: input.setIndex,
      weight_kg: input.weightKg,
      reps: input.reps,
      kind: input.kind,
      parent_set_id: input.parentSetId ?? null,
      completed_at: (input.completedAt ?? now).toISOString(),
    }
    const clientUpdatedAt = now.toISOString()
    await db.transaction(async (tx) => {
      await writeSet(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: SET_LOG_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
    return id
  },

  /**
   * Stores a sub-set (drop or rest-pause) under a done set, with the parent's exercise, planned exercise and set index.
   * Idempotent per parent + kind + ordinal: when the parent already has `ordinal` live sub-sets of that kind (a double tap,
   * or the slot was filled elsewhere), nothing is written and the existing one's id is returned.
   */
  async logSubSet(
    db: LocalDb,
    _userId: string,
    input: { parentSetId: string; kind: 'drop' | 'rest_pause'; ordinal: number; weightKg: number; reps: number; completedAt?: Date },
    now: Date,
  ): Promise<string> {
    return db.transaction(async (tx) => {
      const [parent] = await tx.query<SetRow>('SELECT * FROM set_logs WHERE id = ? AND deleted_at IS NULL', [input.parentSetId])
      if (!parent) throw new Error('Set not found.')
      const siblings = await tx.query<{ id: string }>(
        'SELECT id FROM set_logs WHERE parent_set_id = ? AND kind = ? AND deleted_at IS NULL ORDER BY completed_at, id',
        [input.parentSetId, input.kind],
      )
      const existing = siblings[input.ordinal - 1]
      if (existing) return existing.id
      const [latest] = await tx.query<{ at: string | null }>(
        'SELECT MAX(completed_at) AS at FROM set_logs WHERE parent_set_id = ? AND deleted_at IS NULL',
        [input.parentSetId],
      )
      const after = Math.max(Date.parse(parent.completed_at), latest?.at ? Date.parse(latest.at) : 0)
      const id = newId()
      const payload: SetPayload = {
        session_id: parent.session_id,
        exercise_id: parent.exercise_id,
        planned_exercise_key: parent.planned_exercise_key,
        set_index: parent.set_index,
        weight_kg: input.weightKg,
        reps: input.reps,
        kind: input.kind,
        parent_set_id: parent.id,
        // After the parent and the sub-sets already done, even if the clock went backwards: the order they were done is kept.
        completed_at: new Date(Math.max((input.completedAt ?? now).getTime(), after + 1)).toISOString(),
      }
      const clientUpdatedAt = now.toISOString()
      await writeSet(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: SET_LOG_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
      return id
    })
  },

  async updateSet(db: LocalDb, _userId: string, setId: string, patch: SetPatch, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<SetRow>('SELECT * FROM set_logs WHERE id = ? AND deleted_at IS NULL', [setId])
      if (!row) throw new Error('Set not found.')
      const payload: SetPayload = {
        ...setPayload(row),
        ...(patch.weightKg !== undefined && { weight_kg: patch.weightKg }),
        ...(patch.reps !== undefined && { reps: patch.reps }),
        ...(patch.kind !== undefined && { kind: patch.kind }),
        ...(patch.setIndex !== undefined && { set_index: patch.setIndex }),
      }
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await writeSet(tx, setId, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: SET_LOG_ENTITY, id: setId, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
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

  /** Records that a planned exercise was swapped for another or skipped in this session. */
  async recordChange(db: LocalDb, _userId: string, input: ExerciseChangeInput, now: Date): Promise<string> {
    const id = newId()
    const payload: ChangePayload = {
      session_id: input.sessionId,
      planned_exercise_key: input.plannedExerciseKey,
      action: input.action,
      replacement_exercise_id: input.action === 'swapped' ? (input.replacementExerciseId ?? null) : null,
      note: input.note ?? null,
    }
    const clientUpdatedAt = now.toISOString()
    await db.transaction(async (tx) => {
      await writeChange(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: EXERCISE_CHANGE_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
    return id
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
      const p = payload as SessionPayload
      await writeSession(
        db,
        record.id,
        { ...p, ended_at: p.ended_at === null ? null : iso(p.ended_at), started_at: iso(p.started_at), note: p.note ?? null, notes: p.notes ?? null },
        clientUpdatedAt,
        record.version,
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
        { ...p, planned_exercise_key: p.planned_exercise_key ?? null, parent_set_id: p.parent_set_id ?? null, completed_at: iso(p.completed_at) },
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
