import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { rotationOverrideIdForDate } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const ROTATION_OVERRIDE_ENTITY = 'rotation_override'

export interface RotationOverrideLocal {
  id: string
  /** yyyy-MM-dd. */
  date: string
  /** The workout day to do on `date`, or `off`. */
  dayKey: string
  clientUpdatedAt: string
}

interface RotationOverridePayload {
  date: string
  workout_day_key: string
}

type Row = { id: string; date: string; workout_day_key: string; client_updated_at: string; deleted_at: string | null }

const toOverride = (row: Row): RotationOverrideLocal => ({
  id: row.id,
  date: row.date,
  dayKey: row.workout_day_key,
  clientUpdatedAt: row.client_updated_at,
})

async function writeRow(db: LocalDb, id: string, p: RotationOverridePayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO rotation_overrides (id, date, workout_day_key, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, workout_day_key = excluded.workout_day_key, client_updated_at = excluded.client_updated_at,
       version = COALESCE(excluded.version, rotation_overrides.version), deleted_at = NULL`,
    [id, p.date, p.workout_day_key, clientUpdatedAt, version],
  )
}

export const rotationOverrideRepo = {
  /** Which workout day (or `off`) to do on `date`, replacing the plan's rotation. One per date: setting it again edits it. */
  async set(db: LocalDb, userId: string, date: string, dayKey: string, now: Date): Promise<string> {
    const id = rotationOverrideIdForDate(userId, date)
    const payload: RotationOverridePayload = { date, workout_day_key: dayKey }
    await db.transaction(async (tx) => {
      const [row] = await tx.query<Row>('SELECT * FROM rotation_overrides WHERE id = ?', [id])
      const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
      await writeRow(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: ROTATION_OVERRIDE_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
    })
    return id
  },

  /** Live overrides with `from <= date <= to` (yyyy-MM-dd), by date. */
  async between(db: LocalDb, from: string, to: string): Promise<RotationOverrideLocal[]> {
    const rows = await db.query<Row>(
      'SELECT * FROM rotation_overrides WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date',
      [from, to],
    )
    return rows.map(toOverride)
  },
}

export const rotationOverrideSync: SyncEntityAdapter = {
  entity: ROTATION_OVERRIDE_ENTITY,
  table: 'rotation_overrides',
  applyRemote: (db, record) =>
    applyPulled(db, ROTATION_OVERRIDE_ENTITY, 'rotation_overrides', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, payload as RotationOverridePayload, clientUpdatedAt, record.version),
    ),
}
