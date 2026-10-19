import { isCalendarDate } from '../domain/calendarDate'
import type { AdherenceTargetType } from '../domain/dayPlan'
import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { adherenceLogId } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'
import { SLOT_KEY } from './scheduleRepo'

export const ADHERENCE_LOG_ENTITY = 'adherence_log'

export type AdherenceStatus = 'done' | 'partial' | 'missed'
export type AdherenceReason = 'no_appetite' | 'no_time' | 'felt_sick' | 'free_meal' | 'other'

export const ADHERENCE_REASONS: readonly AdherenceReason[] = ['no_appetite', 'no_time', 'felt_sick', 'free_meal', 'other']
export const MAX_NOTE_LENGTH = 500

const TARGET_TYPES: readonly AdherenceTargetType[] = ['meal', 'protocol_item', 'cardio', 'workout', 'checkin']
const STATUSES: readonly AdherenceStatus[] = ['done', 'partial', 'missed']

/** One target of a day (a `DayTarget`'s type and key). */
export interface AdherenceTarget {
  /** yyyy-MM-dd. */
  date: string
  targetType: AdherenceTargetType
  targetKey: string
}

export interface AdherenceMark extends AdherenceTarget {
  status: AdherenceStatus
  /** Only for partial / missed; dropped for done. */
  reason?: AdherenceReason | null
  note?: string | null
}

export interface AdherenceLogLocal extends AdherenceTarget {
  id: string
  status: AdherenceStatus
  reason: AdherenceReason | null
  note: string | null
  clientUpdatedAt: string
}

/** The server's payload (snake_case), see AdherenceLogPayload on the API. */
interface AdherenceLogPayload {
  date: string
  target_type: AdherenceTargetType
  target_key: string
  status: AdherenceStatus
  reason: AdherenceReason | null
  note: string | null
}

type Row = {
  id: string
  date: string
  target_type: AdherenceTargetType
  target_key: string
  status: AdherenceStatus
  reason: AdherenceReason | null
  note: string | null
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}


const toLog = (row: Row): AdherenceLogLocal => ({
  id: row.id,
  date: row.date,
  targetType: row.target_type,
  targetKey: row.target_key,
  status: row.status,
  reason: row.reason,
  note: row.note,
  clientUpdatedAt: row.client_updated_at,
})

async function writeRow(db: LocalDb, id: string, p: AdherenceLogPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO adherence_logs (id, date, target_type, target_key, status, reason, note, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, target_type = excluded.target_type, target_key = excluded.target_key, status = excluded.status,
       reason = excluded.reason, note = excluded.note, client_updated_at = excluded.client_updated_at,
       version = COALESCE(excluded.version, adherence_logs.version), deleted_at = NULL`,
    [id, p.date, p.target_type, p.target_key, p.status, p.reason ?? null, p.note ?? null, clientUpdatedAt, version],
  )
}

/** Same rules as the server's validator: anything else would be rejected on push. */
function toPayload(mark: AdherenceMark): AdherenceLogPayload {
  if (!isCalendarDate(mark.date)) throw new RangeError(`Invalid date: ${mark.date}`)
  if (!TARGET_TYPES.includes(mark.targetType)) throw new RangeError(`Invalid target type: ${mark.targetType}`)
  if (!SLOT_KEY.test(mark.targetKey)) throw new RangeError(`Invalid target key: ${mark.targetKey}`)
  if (!STATUSES.includes(mark.status)) throw new RangeError(`Invalid status: ${mark.status}`)
  const reason = mark.status === 'done' ? null : (mark.reason ?? null)
  if (reason !== null && !ADHERENCE_REASONS.includes(reason)) throw new RangeError(`Invalid reason: ${reason}`)
  const note = mark.note?.trim() ? mark.note : null
  if (note !== null && note.length > MAX_NOTE_LENGTH) throw new RangeError('Note too long')
  return { date: mark.date, target_type: mark.targetType, target_key: mark.targetKey, status: mark.status, reason, note }
}

export const adherenceRepo = {
  /** Marks a target of a day and queues it, in one transaction. One per target and day: marking again replaces it. */
  async mark(db: LocalDb, userId: string, mark: AdherenceMark, now: Date): Promise<string> {
    const payload = toPayload(mark)
    const id = adherenceLogId(userId, mark.date, mark.targetType, mark.targetKey)
    await db.transaction(async (tx) => {
      const [row] = await tx.query<Row>('SELECT * FROM adherence_logs WHERE id = ?', [id])
      const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
      await writeRow(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: ADHERENCE_LOG_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
    return id
  },

  /** Removes the mark (soft, like the server) and queues the delete, in one transaction. No-op when there is none. */
  async clear(db: LocalDb, userId: string, target: AdherenceTarget, now: Date): Promise<void> {
    const id = adherenceLogId(userId, target.date, target.targetType, target.targetKey)
    await db.transaction(async (tx) => {
      const [row] = await tx.query<Row>('SELECT * FROM adherence_logs WHERE id = ?', [id])
      if (!row || row.deleted_at !== null) return
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE adherence_logs SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, id])
      await outbox.enqueue(tx, { entity: ADHERENCE_LOG_ENTITY, id, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  /** Live marks with `from <= date <= to` (yyyy-MM-dd), by date, type and key. */
  async between(db: LocalDb, from: string, to: string): Promise<AdherenceLogLocal[]> {
    const rows = await db.query<Row>(
      'SELECT * FROM adherence_logs WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, target_type, target_key',
      [from, to],
    )
    return rows.map(toLog)
  },
}

export const adherenceLogSync: SyncEntityAdapter = {
  entity: ADHERENCE_LOG_ENTITY,
  table: 'adherence_logs',
  applyRemote: (db, record) =>
    applyPulled(db, ADHERENCE_LOG_ENTITY, 'adherence_logs', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, payload as AdherenceLogPayload, clientUpdatedAt, record.version),
    ),
}
