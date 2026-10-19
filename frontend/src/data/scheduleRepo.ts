import type { DayType } from '../domain/dayPlan'
import type { ProtocolDocument } from '../domain/planDocuments'
import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { scheduleSlotId } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const SCHEDULE_SLOT_ENTITY = 'schedule_slot'

export const DAY_TYPES: readonly DayType[] = ['training', 'off']

/** The time of a slot (`meal_<key>`, `fasting`, `pre_workout`, `workout`, …) on one type of day. Fits `buildDay`'s `DaySlot`. */
export interface ScheduleSlotLocal {
  id: string
  slot: string
  dayType: DayType
  /** HH:mm. */
  time: string
  reminderEnabled: boolean
  clientUpdatedAt: string
}

export interface ScheduleSlotFields {
  /** HH:mm, 00:00 to 23:59. */
  time: string
  reminderEnabled: boolean
}

/** One change for `setMany`. */
export interface ScheduleSlotChange {
  slot: string
  dayType: DayType
  fields: ScheduleSlotFields
}

/** The server's payload (snake_case), see ScheduleSlotPayload on the API. */
interface ScheduleSlotPayload {
  slot: string
  day_type: DayType
  time: string
  reminder_enabled: boolean
}

type Row = {
  id: string
  slot: string
  day_type: DayType
  time: string
  reminder_enabled: number
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}

/** Same patterns as the server (TodayPayloads.cs): anything else would be rejected on push. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const SLOT_KEY = /^[A-Za-z0-9_:-]{1,64}$/

/**
 * The client_updated_at of the suggested times: older than any real edit, so a default created on a device that has
 * not pulled yet never overwrites a time the user set on another one (the server answers `stale` and the pull brings
 * the user's row).
 */
export const DEFAULTS_CLIENT_UPDATED_AT = '2000-01-01T00:00:00.000Z'

const FIXED_DEFAULTS: readonly (readonly [string, string])[] = [
  ['fasting', '06:30'],
  ['checkin_morning', '07:00'],
  ['cardio', '07:30'],
  ['pre_workout', '17:30'],
  ['workout', '18:00'],
  ['post_workout', '19:30'],
  ['checkin', '21:30'],
  ['before_bed', '22:30'],
]

const FIRST_MEAL_MINUTES = 7 * 60
const MEAL_INTERVAL_MINUTES = 3 * 60
const LAST_MINUTE = 23 * 60 + 59

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * The suggested times (spec "Hoje", Horários): meals every 3 h from 07:00 by position in the protocol (capped at 23:59),
 * fasting 06:30, morning check-in 07:00, cardio 07:30, pre-workout 17:30, workout 18:00, post-workout 19:30, evening
 * check-in (slot `checkin`) 21:30, before bed 22:30;
 * the same for training and rest days, reminders on. `intra_workout` and `after_meal` have no default (untimed).
 */
export function defaultSlotTimes(protocol: ProtocolDocument | null): { slot: string; time: string }[] {
  const result: { slot: string; time: string }[] = []
  const seen = new Set<string>()
  for (const [i, meal] of (protocol?.meals ?? []).entries()) {
    const slot = `meal_${meal.key}`
    // A key the server would reject stays untimed; a repeated key keeps its first position.
    if (!SLOT_KEY.test(slot) || seen.has(slot)) continue
    seen.add(slot)
    result.push({ slot, time: hhmm(Math.min(FIRST_MEAL_MINUTES + MEAL_INTERVAL_MINUTES * i, LAST_MINUTE)) })
  }
  for (const [slot, time] of FIXED_DEFAULTS) result.push({ slot, time })
  return result
}

const toSlot = (row: Row): ScheduleSlotLocal => ({
  id: row.id,
  slot: row.slot,
  dayType: row.day_type,
  time: row.time,
  reminderEnabled: row.reminder_enabled !== 0,
  clientUpdatedAt: row.client_updated_at,
})

async function writeRow(db: LocalDb, id: string, p: ScheduleSlotPayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO schedule_slots (id, slot, day_type, time, reminder_enabled, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       slot = excluded.slot, day_type = excluded.day_type, time = excluded.time, reminder_enabled = excluded.reminder_enabled,
       client_updated_at = excluded.client_updated_at, version = COALESCE(excluded.version, schedule_slots.version), deleted_at = NULL`,
    [id, p.slot, p.day_type, p.time, p.reminder_enabled ? 1 : 0, clientUpdatedAt, version],
  )
}

async function upsert(tx: LocalDb, id: string, payload: ScheduleSlotPayload, clientUpdatedAt: string) {
  await writeRow(tx, id, payload, clientUpdatedAt, null)
  await outbox.enqueue(tx, { entity: SCHEDULE_SLOT_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
}

export const scheduleRepo = {
  /** Every live slot time, by slot then day type. */
  async all(db: LocalDb): Promise<ScheduleSlotLocal[]> {
    const rows = await db.query<Row>('SELECT * FROM schedule_slots WHERE deleted_at IS NULL ORDER BY slot, day_type')
    return rows.map(toSlot)
  },

  /**
   * Creates the suggested time of every (slot, day type) that has no row yet (live or deleted), and queues them, in one
   * transaction. Never touches an existing row, so it is safe to call on every visit. Returns how many it created.
   */
  async ensureDefaults(db: LocalDb, userId: string, protocol: ProtocolDocument | null): Promise<number> {
    const defaults = defaultSlotTimes(protocol)
    return db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string; slot: string; day_type: string }>('SELECT id, slot, day_type FROM schedule_slots')
      const taken = new Set(existing.flatMap((r) => [r.id, `${r.slot}\n${r.day_type}`]))
      let created = 0
      for (const { slot, time } of defaults) {
        for (const dayType of DAY_TYPES) {
          const id = scheduleSlotId(userId, slot, dayType)
          if (taken.has(id) || taken.has(`${slot}\n${dayType}`)) continue
          await upsert(tx, id, { slot, day_type: dayType, time, reminder_enabled: true }, DEFAULTS_CLIENT_UPDATED_AT)
          created++
        }
      }
      return created
    })
  },

  /** Sets the time of `slot` on `dayType` days and queues it, in one transaction. Throws on a time or slot the server would reject. */
  async set(db: LocalDb, userId: string, slot: string, dayType: DayType, fields: ScheduleSlotFields, now: Date): Promise<string> {
    const [id] = await scheduleRepo.setMany(db, userId, [{ slot, dayType, fields }], now)
    return id!
  },

  /**
   * Several `set`s in one transaction (rows and outbox): all or nothing. Every entry is validated before anything is
   * written. Returns the ids, in order.
   */
  async setMany(db: LocalDb, userId: string, entries: readonly ScheduleSlotChange[], now: Date): Promise<string[]> {
    for (const { slot, dayType, fields } of entries) {
      if (!SLOT_KEY.test(slot)) throw new RangeError(`Invalid slot: ${slot}`)
      if (!DAY_TYPES.includes(dayType)) throw new RangeError(`Invalid day type: ${dayType}`)
      if (!TIME.test(fields.time)) throw new RangeError(`Invalid time: ${fields.time}`)
    }
    return db.transaction(async (tx) => {
      const ids: string[] = []
      for (const { slot, dayType, fields } of entries) {
        const id = scheduleSlotId(userId, slot, dayType)
        const payload: ScheduleSlotPayload = { slot, day_type: dayType, time: fields.time, reminder_enabled: fields.reminderEnabled }
        const [row] = await tx.query<Row>('SELECT * FROM schedule_slots WHERE id = ?', [id])
        await upsert(tx, id, payload, nextClientUpdatedAt(now, row?.client_updated_at))
        ids.push(id)
      }
      return ids
    })
  },
}

export const scheduleSlotSync: SyncEntityAdapter = {
  entity: SCHEDULE_SLOT_ENTITY,
  table: 'schedule_slots',
  applyRemote: (db, record) =>
    applyPulled(db, SCHEDULE_SLOT_ENTITY, 'schedule_slots', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, payload as ScheduleSlotPayload, clientUpdatedAt, record.version),
    ),
}
