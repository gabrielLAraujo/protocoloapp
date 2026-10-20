import type { SyncRecord } from './apiClient'
import { localChangeWins, nextClientUpdatedAt, normalizeTimestamp, type SyncEntityAdapter } from './entities'
import { checkinIdForDate } from './ids'
import type { LocalDb } from './localDb'
import { outbox, type OutboxEntry } from './outbox'
import { syncState } from './syncState'

export const DAILY_CHECKIN_ENTITY = 'daily_checkin'

export type Bowel = 'normal' | 'loose' | 'constipated'

/** The parts of a day's check-in, each saved on its own (the server's `parts` list). */
export type CheckinPart = 'morning' | 'evening' | 'cardio'
export const CHECKIN_PARTS: readonly CheckinPart[] = ['morning', 'evening', 'cardio']

/**
 * A day's check-in. The fields of a part are all null until that part is saved (a row created by cardio alone has
 * both parts null); a check-in saved before the split has every part set.
 */
export interface DailyCheckinFields {
  /** Morning, 1–5. */
  sleepQuality: number | null
  /** Morning. */
  bowel: Bowel | null
  /** Morning, 1–5. */
  energyWake: number | null
  /** Morning (optional), kg 30–300. */
  weightKg: number | null
  /** Evening, 1–5. */
  energyDay: number | null
  /** Evening, 1–5. */
  anxiety: number | null
  /** Evening, liters 0–15. */
  waterL: number | null
  /** Evening (optional). */
  note: string | null
  /** Cardio. Null: not answered. */
  cardioDone: boolean | null
  /** Cardio, 0–300; only with cardioDone === true, else null. */
  cardioMinutes: number | null
}

/** What the morning screen saves. */
export interface MorningFields {
  sleepQuality: number
  energyWake: number
  bowel: Bowel
  weightKg: number | null
}

/** What the evening screen saves. An empty note is stored (and sent) as null. */
export interface EveningFields {
  energyDay: number
  anxiety: number
  waterL: number
  note: string | null
}

/** What the Cardio item of Hoje saves. `done: null` clears cardio; minutes only count with `done === true`. */
export interface CardioFields {
  done: boolean | null
  minutes: number | null
}

/** Which parts of a day's check-in are saved. */
export interface CheckinParts {
  morning: boolean
  evening: boolean
}

/** The fields that make each part complete (weight and note are optional; cardio is not a part of the check-in). */
type PartFields = {
  sleepQuality: number | null
  energyWake: number | null
  bowel: Bowel | null
  energyDay: number | null
  anxiety: number | null
  waterL: number | null
}

/**
 * Morning = sleep quality, energy on waking and bowel all set; evening = energy during the day, anxiety and water all
 * set. A full check-in saved before the split counts as both; a row created only by cardio as neither.
 */
export function checkinParts(row: PartFields): CheckinParts {
  return {
    morning: row.sleepQuality != null && row.energyWake != null && row.bowel != null,
    evening: row.energyDay != null && row.anxiety != null && row.waterL != null,
  }
}

export interface DailyCheckin extends DailyCheckinFields {
  id: string
  /** yyyy-MM-dd. */
  date: string
  clientUpdatedAt: string
}

/**
 * The server's payload (snake_case), see DailyCheckinPayload on the API. A pushed change always carries the whole local
 * row plus `parts`: the server applies only the listed parts (null clears a field of a listed part) and keeps the
 * others. Pulled records carry every field and no `parts`; a queued change without `parts` (from an older app version)
 * is a full overwrite.
 */
export interface DailyCheckinPayload {
  date: string
  parts?: CheckinPart[]
  sleep_quality: number | null
  bowel: Bowel | null
  energy_wake: number | null
  energy_day: number | null
  anxiety: number | null
  water_l: number | null
  weight_kg: number | null
  note: string | null
  cardio_done: boolean | null
  cardio_minutes: number | null
}

type Row = {
  id: string
  date: string
  sleep_quality: number | null
  bowel: Bowel | null
  energy_wake: number | null
  energy_day: number | null
  anxiety: number | null
  water_l: number | null
  weight_kg: number | null
  note: string | null
  cardio_done: number | null
  cardio_minutes: number | null
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}

const EMPTY: DailyCheckinFields = {
  sleepQuality: null, bowel: null, energyWake: null, weightKg: null,
  energyDay: null, anxiety: null, waterL: null, note: null,
  cardioDone: null, cardioMinutes: null,
}

/** Keeps a row consistent: minutes only with cardio done, an empty note is no note (the server is sent null, not ""). */
const normalize = (f: DailyCheckinFields): DailyCheckinFields => ({
  ...f,
  note: f.note === null || f.note.trim() === '' ? null : f.note,
  cardioMinutes: f.cardioDone === true ? f.cardioMinutes : null,
})

const toPayload = (date: string, f: DailyCheckinFields, parts?: readonly CheckinPart[]): DailyCheckinPayload => ({
  date,
  ...(parts ? { parts: [...parts] } : {}),
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

/** A pulled (or older) payload: fields missing from it read as null (clients before cardio lack the two cardio fields). */
const fromPayload = (p: Partial<DailyCheckinPayload>): DailyCheckinFields => ({
  sleepQuality: p.sleep_quality ?? null,
  bowel: p.bowel ?? null,
  energyWake: p.energy_wake ?? null,
  weightKg: p.weight_kg ?? null,
  energyDay: p.energy_day ?? null,
  anxiety: p.anxiety ?? null,
  waterL: p.water_l ?? null,
  note: p.note ?? null,
  cardioDone: p.cardio_done ?? null,
  cardioMinutes: p.cardio_minutes ?? null,
})

const fieldsOf = (row: Row): DailyCheckinFields => ({
  sleepQuality: row.sleep_quality,
  bowel: row.bowel,
  energyWake: row.energy_wake,
  weightKg: row.weight_kg,
  energyDay: row.energy_day,
  anxiety: row.anxiety,
  waterL: row.water_l,
  note: row.note,
  cardioDone: row.cardio_done == null ? null : row.cardio_done !== 0,
  cardioMinutes: row.cardio_minutes,
})

const toCheckin = (row: Row): DailyCheckin => ({ id: row.id, date: row.date, ...fieldsOf(row), clientUpdatedAt: row.client_updated_at })

/** The fields of `part` taken from `from`, the rest from `into`. */
function withPart(into: DailyCheckinFields, from: DailyCheckinFields, part: CheckinPart): DailyCheckinFields {
  switch (part) {
    case 'morning':
      return { ...into, sleepQuality: from.sleepQuality, energyWake: from.energyWake, bowel: from.bowel, weightKg: from.weightKg }
    case 'evening':
      return { ...into, energyDay: from.energyDay, anxiety: from.anxiety, waterL: from.waterL, note: from.note }
    case 'cardio':
      return { ...into, cardioDone: from.cardioDone, cardioMinutes: from.cardioMinutes }
  }
}

const byId = async (db: LocalDb, id: string) =>
  (await db.query<Row>('SELECT * FROM daily_checkins WHERE id = ?', [id]))[0]

/** Writes the row (live) with `version`; null keeps the server version the row already has. */
async function writeRow(db: LocalDb, id: string, date: string, f: DailyCheckinFields, clientUpdatedAt: string, version: number | null) {
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
    [id, date, f.sleepQuality, f.bowel, f.energyWake, f.energyDay, f.anxiety, f.waterL, f.weightKg, f.note,
      f.cardioDone == null ? null : f.cardioDone ? 1 : 0, f.cardioDone === true ? f.cardioMinutes : null, clientUpdatedAt, version],
  )
}

/** The parts a queued upsert changes; one without `parts` (older app version) changes them all. */
function partsOf(entry: OutboxEntry): readonly CheckinPart[] {
  if (entry.payload === null) return CHECKIN_PARTS
  const parts = (JSON.parse(entry.payload) as Partial<DailyCheckinPayload>).parts
  return Array.isArray(parts) ? parts : CHECKIN_PARTS
}

/**
 * Reads the day's row, lets `change` build the new fields from it (an empty row when there is none, or it was deleted),
 * writes the whole row and queues it with `parts`, in one transaction. Returns the new client_updated_at.
 */
async function saveParts(
  db: LocalDb,
  userId: string,
  date: string,
  parts: readonly CheckinPart[],
  change: (current: DailyCheckinFields) => DailyCheckinFields,
  now: Date,
): Promise<string> {
  const id = checkinIdForDate(userId, date)
  return db.transaction(async (tx) => {
    const row = await byId(tx, id)
    const live = row && row.deleted_at === null ? row : undefined
    const fields = normalize(change(live ? fieldsOf(live) : EMPTY))
    const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
    await writeRow(tx, id, date, fields, clientUpdatedAt, null)
    await outbox.enqueue(tx, {
      entity: DAILY_CHECKIN_ENTITY,
      id,
      op: 'upsert',
      payload: JSON.stringify(toPayload(date, fields, parts)),
      clientUpdatedAt,
    })
    return clientUpdatedAt
  })
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
    // Two live rows for one date (the same day written on two devices): the newest wins.
    const seen = new Set<string>()
    return rows.filter((r) => !seen.has(r.date) && !!seen.add(r.date)).map(toCheckin)
  },

  /** Saves the morning part, keeping the evening and cardio of the day; creates the row when there is none. */
  saveMorning(db: LocalDb, userId: string, date: string, fields: MorningFields, now: Date): Promise<string> {
    return saveParts(db, userId, date, ['morning'], (current) => ({ ...current, ...fields }), now)
  },

  /** Saves the evening part, keeping the morning and cardio of the day; creates the row when there is none. */
  saveEvening(db: LocalDb, userId: string, date: string, fields: EveningFields, now: Date): Promise<string> {
    return saveParts(db, userId, date, ['evening'], (current) => ({ ...current, ...fields }), now)
  },

  /**
   * Sets (or clears, with `done: null`) the day's cardio, keeping both parts; creates a row with both parts null when
   * there is none.
   */
  setCardio(db: LocalDb, userId: string, date: string, cardio: CardioFields, now: Date): Promise<string> {
    return saveParts(db, userId, date, ['cardio'], (current) => ({ ...current, cardioDone: cardio.done, cardioMinutes: cardio.minutes }), now)
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

  /**
   * Applies a pulled record, part by part: a part with a pending local change keeps the local values (the change is on
   * its way to the server), every other part takes the server's. Deletes, and rows with a pending local delete, keep
   * the whole-row rule of the other entities.
   *
   * Whenever a pending part is kept, the row is stored one version below the record: the server may hold a newer value
   * for that part (its per-part clock is not in the record), and if the push then comes back `stale`, onStale rewinds the
   * pull cursor and this record is applied again, now with nothing pending. When the push is applied instead, the
   * server's next version supersedes the record anyway.
   */
  async applyRemote(db: LocalDb, record: SyncRecord): Promise<void> {
    const local = await byId(db, record.id)
    // Already have this server version or a later one.
    if (local?.version != null && record.version <= local.version) return

    const clientUpdatedAt = normalizeTimestamp(record.clientUpdatedAt)
    const pending = await outbox.pendingFor(db, DAILY_CHECKIN_ENTITY, record.id)
    const deleted = record.deletedAt !== null || record.payload === null
    if (deleted || pending.some((e) => e.op === 'delete')) {
      if (await localChangeWins(db, DAILY_CHECKIN_ENTITY, record.id, local?.client_updated_at, record.clientUpdatedAt)) return
      if (!deleted) {
        const p = record.payload as Partial<DailyCheckinPayload>
        await writeRow(db, record.id, p.date as string, normalize(fromPayload(p)), clientUpdatedAt, record.version)
        return
      }
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

    const payload = record.payload as Partial<DailyCheckinPayload>
    let fields = fromPayload(payload)
    let version = record.version
    let stamp = clientUpdatedAt
    if (local && local.deleted_at === null && pending.length > 0) {
      const localFields = fieldsOf(local)
      for (const part of CHECKIN_PARTS) {
        if (!pending.some((e) => partsOf(e).includes(part))) continue
        fields = withPart(fields, localFields, part)
        version = record.version - 1
      }
      // The next local change must stay after both clocks.
      if (Date.parse(local.client_updated_at) > Date.parse(record.clientUpdatedAt)) stamp = local.client_updated_at
    }
    await writeRow(db, record.id, payload.date as string, normalize(fields), stamp, version)
  },

  /**
   * A pushed change came back `stale`: the server kept newer values for its parts. The local row may still show the
   * pushed ones (kept by applyRemote while the change was pending), and the record carrying the server's values may be
   * behind the pull cursor already, so the cursor goes back to the row's version and the next pull brings it again.
   * The row's version may be older than the record that made the push stale (a pull since then was version-skipped or
   * kept a pending part), so this can re-pull more than needed: bounded by the records after that version, and harmless
   * (records are applied idempotently, version-skip drops what is already here).
   */
  async onStale(db: LocalDb, entry: OutboxEntry): Promise<void> {
    const row = await byId(db, entry.id)
    if (row?.version == null) return
    const since = Number((await syncState.get(db, 'last_since')) ?? 0)
    if (row.version < since) await syncState.set(db, 'last_since', String(row.version))
  },
}

export const dailyCheckinSync: SyncEntityAdapter = {
  entity: DAILY_CHECKIN_ENTITY,
  table: 'daily_checkins',
  applyRemote: (db, record) => dailyCheckinRepo.applyRemote(db, record),
  onStale: (db, entry) => dailyCheckinRepo.onStale(db, entry),
}
