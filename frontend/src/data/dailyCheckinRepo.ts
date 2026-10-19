import type { SyncRecord } from './apiClient'
import { localChangeWins, nextClientUpdatedAt, normalizeTimestamp, type SyncEntityAdapter } from './entities'
import { checkinIdForDate } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const DAILY_CHECKIN_ENTITY = 'daily_checkin'

export type Bowel = 'normal' | 'loose' | 'constipated'

export interface DailyCheckinFields {
  /** 1–5. */
  sleepQuality: number
  bowel: Bowel
  /** 1–5. */
  energyWake: number
  /** 1–5. */
  energyDay: number
  /** 1–5. */
  anxiety: number
  /** Liters, 0–15. */
  waterL: number
  /** Kg, 30–300. */
  weightKg: number | null
  note: string | null
  /** Null: not answered. */
  cardioDone: boolean | null
  /** 0–300; only with cardioDone === true, else null. */
  cardioMinutes: number | null
}

export interface DailyCheckin extends DailyCheckinFields {
  id: string
  /** yyyy-MM-dd. */
  date: string
  clientUpdatedAt: string
}

/** The server's payload (snake_case), see DailyCheckinPayload on the API. */
export interface DailyCheckinPayload {
  date: string
  sleep_quality: number
  bowel: Bowel
  energy_wake: number
  energy_day: number
  anxiety: number
  water_l: number
  weight_kg: number | null
  note: string | null
  cardio_done: boolean | null
  cardio_minutes: number | null
}

type Row = {
  id: string
  date: string
  sleep_quality: number
  bowel: Bowel
  energy_wake: number
  energy_day: number
  anxiety: number
  water_l: number
  weight_kg: number | null
  note: string | null
  cardio_done: number | null
  cardio_minutes: number | null
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}

const toPayload = (date: string, f: DailyCheckinFields): DailyCheckinPayload => ({
  date,
  sleep_quality: f.sleepQuality,
  bowel: f.bowel,
  energy_wake: f.energyWake,
  energy_day: f.energyDay,
  anxiety: f.anxiety,
  water_l: f.waterL,
  weight_kg: f.weightKg,
  note: f.note,
  cardio_done: f.cardioDone,
  cardio_minutes: f.cardioDone === true ? f.cardioMinutes : null,
})

const toCheckin = (row: Row): DailyCheckin => ({
  id: row.id,
  date: row.date,
  sleepQuality: row.sleep_quality,
  bowel: row.bowel,
  energyWake: row.energy_wake,
  energyDay: row.energy_day,
  anxiety: row.anxiety,
  waterL: row.water_l,
  weightKg: row.weight_kg,
  note: row.note,
  cardioDone: row.cardio_done == null ? null : row.cardio_done !== 0,
  cardioMinutes: row.cardio_minutes,
  clientUpdatedAt: row.client_updated_at,
})

const byId = async (db: LocalDb, id: string) =>
  (await db.query<Row>('SELECT * FROM daily_checkins WHERE id = ?', [id]))[0]

/** Writes the row (live), keeping the server version it came with. */
async function writeRow(db: LocalDb, id: string, p: DailyCheckinPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO daily_checkins
       (id, date, sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note, cardio_done, cardio_minutes, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       date = excluded.date, sleep_quality = excluded.sleep_quality, bowel = excluded.bowel,
       energy_wake = excluded.energy_wake, energy_day = excluded.energy_day, anxiety = excluded.anxiety,
       water_l = excluded.water_l, weight_kg = excluded.weight_kg, note = excluded.note,
       cardio_done = excluded.cardio_done, cardio_minutes = excluded.cardio_minutes,
       client_updated_at = excluded.client_updated_at, version = COALESCE(excluded.version, daily_checkins.version),
       deleted_at = NULL`,
    [id, p.date, p.sleep_quality, p.bowel, p.energy_wake, p.energy_day, p.anxiety, p.water_l, p.weight_kg, p.note,
      p.cardio_done == null ? null : p.cardio_done ? 1 : 0, p.cardio_minutes ?? null, clientUpdatedAt, version],
  )
}

/** The stored check-in changed since the screen read it (a pull from another device): saving would overwrite it. */
export class StaleCheckinError extends Error {
  constructor() {
    super('The check-in changed since it was read.')
    this.name = 'StaleCheckinError'
  }
}

export const dailyCheckinRepo = {
  async get(db: LocalDb, date: string): Promise<DailyCheckin | null> {
    const [row] = await db.query<Row>(
      'SELECT * FROM daily_checkins WHERE date = ? AND deleted_at IS NULL ORDER BY client_updated_at DESC LIMIT 1',
      [date],
    )
    return row ? toCheckin(row) : null
  },

  /** Live check-ins with `from <= date <= to` (yyyy-MM-dd), oldest first. */
  async between(db: LocalDb, from: string, to: string): Promise<DailyCheckin[]> {
    const rows = await db.query<Row>(
      'SELECT * FROM daily_checkins WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, client_updated_at DESC',
      [from, to],
    )
    return rows.map(toCheckin)
  },

  /**
   * Saves the day's check-in and queues it for the server, in one transaction. Returns the row's new client_updated_at.
   * With `expected` (the client_updated_at the screen loaded, null when there was no live row), throws
   * StaleCheckinError instead of saving when the stored row is no longer that one.
   */
  async upsert(
    db: LocalDb,
    userId: string,
    date: string,
    fields: DailyCheckinFields,
    now: Date,
    options: { expected?: string | null } = {},
  ): Promise<string> {
    const id = checkinIdForDate(userId, date)
    const payload = toPayload(date, fields)
    return db.transaction(async (tx) => {
      const row = await byId(tx, id)
      if (options.expected !== undefined) {
        const live = row && row.deleted_at === null ? row.client_updated_at : null
        if (live !== options.expected) throw new StaleCheckinError()
      }
      const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
      await writeRow(tx, id, payload, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: DAILY_CHECKIN_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
      return clientUpdatedAt
    })
  },

  /** Deletes the day's check-in (soft, like the server) and queues the delete. No-op when there is none. */
  async remove(db: LocalDb, userId: string, date: string, now: Date): Promise<void> {
    const id = checkinIdForDate(userId, date)
    await db.transaction(async (tx) => {
      const row = await byId(tx, id)
      if (!row || row.deleted_at !== null) return
      const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
      await tx.execute('UPDATE daily_checkins SET deleted_at = ?, client_updated_at = ? WHERE id = ?', [clientUpdatedAt, clientUpdatedAt, id])
      await outbox.enqueue(tx, { entity: DAILY_CHECKIN_ENTITY, id, op: 'delete', payload: null, clientUpdatedAt })
    })
  },

  async applyRemote(db: LocalDb, record: SyncRecord): Promise<void> {
    const local = await byId(db, record.id)
    // Already have this server version or a later one.
    if (local?.version != null && record.version <= local.version) return
    if (await localChangeWins(db, DAILY_CHECKIN_ENTITY, record.id, local?.client_updated_at, record.clientUpdatedAt)) return

    const clientUpdatedAt = normalizeTimestamp(record.clientUpdatedAt)
    if (record.deletedAt !== null || record.payload === null) {
      // Nothing to hide when the row never reached this device.
      if (local)
        await db.execute('UPDATE daily_checkins SET deleted_at = ?, client_updated_at = ?, version = ? WHERE id = ?', [
          normalizeTimestamp(record.deletedAt ?? record.clientUpdatedAt),
          clientUpdatedAt,
          record.version,
          record.id,
        ])
      return
    }
    // Payloads from clients that predate cardio lack the two fields (read as not answered).
    await writeRow(db, record.id, record.payload as DailyCheckinPayload, clientUpdatedAt, record.version)
  },
}

export const dailyCheckinSync: SyncEntityAdapter = {
  entity: DAILY_CHECKIN_ENTITY,
  table: 'daily_checkins',
  applyRemote: (db, record) => dailyCheckinRepo.applyRemote(db, record),
}
