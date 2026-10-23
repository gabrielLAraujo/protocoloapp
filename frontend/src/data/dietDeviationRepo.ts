import { isCalendarDate } from '../domain/calendarDate'
import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { newId } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'
import { SLOT_KEY } from './scheduleRepo'

export const DIET_DEVIATION_ENTITY = 'diet_deviation'
export const MAX_DESCRIPTION_LENGTH = 200
export const MAX_QUANTITY_LENGTH = 60

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Something eaten outside the plan on a day: inside a meal (`mealKey`) or as an extra meal (`mealKey` null). */
export interface DietDeviationInput {
  /** yyyy-MM-dd. */
  date: string
  mealKey: string | null
  /** HH:mm (the extra meal's time), or null. */
  time: string | null
  description: string
  quantity: string | null
}

export interface DietDeviationLocal extends DietDeviationInput {
  id: string
  clientUpdatedAt: string
}

/** The server's payload (snake_case), see DietDeviationPayload on the API. */
interface DietDeviationPayload {
  date: string
  meal_key: string | null
  time: string | null
  description: string
  quantity: string | null
}

type Row = {
  id: string
  date: string
  meal_key: string | null
  time: string | null
  description: string
  quantity: string | null
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}

const toLocal = (row: Row): DietDeviationLocal => ({
  id: row.id,
  date: row.date,
  mealKey: row.meal_key,
  time: row.time,
  description: row.description,
  quantity: row.quantity,
  clientUpdatedAt: row.client_updated_at,
})

/** Same rules as the server's validator. The messages never carry the texts (domain content stays out of the logs). */
function toPayload(input: DietDeviationInput): DietDeviationPayload {
  if (!isCalendarDate(input.date)) throw new RangeError('Invalid date')
  if (input.mealKey !== null && !SLOT_KEY.test(input.mealKey)) throw new RangeError('Invalid meal key')
  if (input.time !== null && !TIME.test(input.time)) throw new RangeError('Invalid time')
  const description = input.description.trim()
  if (description === '' || description.length > MAX_DESCRIPTION_LENGTH) throw new RangeError('Invalid description')
  const quantity = input.quantity?.trim() ? input.quantity.trim() : null
  if (quantity !== null && quantity.length > MAX_QUANTITY_LENGTH) throw new RangeError('Invalid quantity')
  return { date: input.date, meal_key: input.mealKey, time: input.time, description, quantity }
}

async function writeRow(db: LocalDb, id: string, p: DietDeviationPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO diet_deviations (id, date, meal_key, time, description, quantity, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, meal_key = excluded.meal_key, time = excluded.time, description = excluded.description,
       quantity = excluded.quantity, client_updated_at = excluded.client_updated_at,
       version = COALESCE(excluded.version, diet_deviations.version), deleted_at = NULL`,
    [id, p.date, p.meal_key ?? null, p.time ?? null, p.description, p.quantity ?? null, clientUpdatedAt, version],
  )
}

async function upsert(db: LocalDb, id: string, input: DietDeviationInput, now: Date, mustExist: boolean) {
  const payload = toPayload(input)
  await db.transaction(async (tx) => {
    const [row] = await tx.query<Row>('SELECT * FROM diet_deviations WHERE id = ?', [id])
    if (mustExist && (!row || row.deleted_at !== null)) throw new RangeError('Unknown deviation')
    const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
    await writeRow(tx, id, payload, clientUpdatedAt, null)
    await outbox.enqueue(tx, { entity: DIET_DEVIATION_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
  })
}

export const dietDeviationRepo = {
  /** Records a new deviation and queues it, in one transaction. Returns its (random) id. */
  async add(db: LocalDb, input: DietDeviationInput, now: Date): Promise<string> {
    const id = newId()
    await upsert(db, id, input, now, false)
    return id
  },

  /** Replaces the fields of a live deviation and queues the change. */
  async update(db: LocalDb, id: string, input: DietDeviationInput, now: Date): Promise<void> {
    await upsert(db, id, input, now, true)
  },

  /** Removes it (soft, like the server) and queues the delete. No-op when it is already gone. */
  async remove(db: LocalDb, id: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.query<Row>('SELECT * FROM diet_deviations WHERE id = ?', [id])
      if (!row || row.deleted_at !== null) return
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE diet_deviations SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, id])
      await outbox.enqueue(tx, { entity: DIET_DEVIATION_ENTITY, id, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  /** Live deviations with `from <= date <= to` (yyyy-MM-dd), by date, then time (none last), then when recorded. */
  async between(db: LocalDb, from: string, to: string): Promise<DietDeviationLocal[]> {
    const rows = await db.query<Row>(
      `SELECT * FROM diet_deviations WHERE date >= ? AND date <= ? AND deleted_at IS NULL
       ORDER BY date, time IS NULL, time, client_updated_at, id`,
      [from, to],
    )
    return rows.map(toLocal)
  },
}

export const dietDeviationSync: SyncEntityAdapter = {
  entity: DIET_DEVIATION_ENTITY,
  table: 'diet_deviations',
  applyRemote: (db, record) =>
    applyPulled(db, DIET_DEVIATION_ENTITY, 'diet_deviations', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, payload as DietDeviationPayload, clientUpdatedAt, record.version),
    ),
}
