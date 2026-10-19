import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProtocolDocument } from '../domain/planDocuments'
import { newLocalDb, USER_A, USER_B } from '../test/localDb'
import { scheduleSlotId } from './ids'
import { outbox } from './outbox'
import { DEFAULTS_CLIENT_UPDATED_AT, defaultSlotTimes, scheduleRepo, scheduleSlotSync } from './scheduleRepo'

const T0 = new Date('2026-10-19T12:00:00.000Z')

const meal = (key: string) => ({ key, label: '', items: [] })
const protocol = (keys: string[]): ProtocolDocument => ({ meals: keys.map(meal), items: [], guidelines: [] })

afterEach(() => vi.restoreAllMocks())

describe('defaultSlotTimes', () => {
  it('meals every 3 h from 07:00 by position, then the fixed slots', () => {
    expect(defaultSlotTimes(protocol(['1', '2', 'ceia']))).toEqual([
      { slot: 'meal_1', time: '07:00' },
      { slot: 'meal_2', time: '10:00' },
      { slot: 'meal_ceia', time: '13:00' },
      { slot: 'fasting', time: '06:30' },
      { slot: 'cardio', time: '07:30' },
      { slot: 'pre_workout', time: '17:30' },
      { slot: 'workout', time: '18:00' },
      { slot: 'post_workout', time: '19:30' },
      { slot: 'checkin', time: '21:30' },
      { slot: 'before_bed', time: '22:30' },
    ])
  })

  it('caps late meals at 23:59, skips keys the server would reject and repeated keys', () => {
    const times = defaultSlotTimes(protocol(['1', '2', '3', '4', '5', '6', '7', 'com espaço', '1']))
    const meals = times.filter((t) => t.slot.startsWith('meal_'))

    expect(meals.map((t) => t.time)).toEqual(['07:00', '10:00', '13:00', '16:00', '19:00', '22:00', '23:59'])
    expect(meals.map((t) => t.slot)).not.toContain('meal_com espaço')
  })

  it('without a protocol only the fixed slots', () => {
    expect(defaultSlotTimes(null).map((t) => t.slot)).toEqual(['fasting', 'cardio', 'pre_workout', 'workout', 'post_workout', 'checkin', 'before_bed'])
  })
})

describe('scheduleRepo', () => {
  it('ensureDefaults creates both day types with deterministic ids and queues them, with the defaults timestamp', async () => {
    const db = await newLocalDb()

    const created = await scheduleRepo.ensureDefaults(db, USER_A, protocol(['1', '2']))

    expect(created).toBe(18)
    const slots = await scheduleRepo.all(db)
    expect(slots).toHaveLength(18)
    expect(slots.find((s) => s.slot === 'meal_2' && s.dayType === 'off')).toEqual({
      id: scheduleSlotId(USER_A, 'meal_2', 'off'),
      slot: 'meal_2',
      dayType: 'off',
      time: '10:00',
      reminderEnabled: true,
      clientUpdatedAt: DEFAULTS_CLIENT_UPDATED_AT,
    })
    const entries = await outbox.due(db, T0, 500)
    expect(entries).toHaveLength(18)
    expect(new Set(entries.map((e) => e.id))).toEqual(new Set(slots.map((s) => s.id)))
    expect(entries.every((e) => e.entity === 'schedule_slot' && e.op === 'upsert' && e.clientUpdatedAt === DEFAULTS_CLIENT_UPDATED_AT)).toBe(true)
    expect(JSON.parse(entries.find((e) => e.id === scheduleSlotId(USER_A, 'workout', 'training'))!.payload!)).toEqual({
      slot: 'workout',
      day_type: 'training',
      time: '18:00',
      reminder_enabled: true,
    })
  })

  it('ensureDefaults is idempotent, keeps user edits and only fills new slots', async () => {
    const db = await newLocalDb()
    await scheduleRepo.ensureDefaults(db, USER_A, protocol(['1']))
    await scheduleRepo.set(db, USER_A, 'meal_1', 'training', { time: '08:15', reminderEnabled: false }, T0)
    const queued = (await outbox.due(db, T0, 500)).length

    expect(await scheduleRepo.ensureDefaults(db, USER_A, protocol(['1']))).toBe(0)
    expect((await outbox.due(db, T0, 500)).length).toBe(queued)

    // A new meal in the next protocol: only its two rows are added.
    expect(await scheduleRepo.ensureDefaults(db, USER_A, protocol(['1', '2']))).toBe(2)
    const slots = await scheduleRepo.all(db)
    expect(slots.find((s) => s.slot === 'meal_1' && s.dayType === 'training')).toMatchObject({ time: '08:15', reminderEnabled: false })
    expect(slots.find((s) => s.slot === 'meal_2' && s.dayType === 'training')).toMatchObject({ time: '10:00', reminderEnabled: true })
  })

  it('ensureDefaults does not revive a deleted row nor add a second row for a pulled slot', async () => {
    const db = await newLocalDb()
    const id = scheduleSlotId(USER_A, 'cardio', 'off')
    await scheduleSlotSync.applyRemote(db, {
      entity: 'schedule_slot', id, version: 1, payload: { slot: 'cardio', day_type: 'off', time: '09:00', reminder_enabled: true },
      deletedAt: null, clientUpdatedAt: '2026-10-19T10:00:00+00:00',
    })
    await scheduleSlotSync.applyRemote(db, {
      entity: 'schedule_slot', id, version: 2, payload: null, deletedAt: '2026-10-19T11:00:00+00:00', clientUpdatedAt: '2026-10-19T11:00:00+00:00',
    })

    await scheduleRepo.ensureDefaults(db, USER_A, null)

    const slots = await scheduleRepo.all(db)
    expect(slots.filter((s) => s.slot === 'cardio').map((s) => s.dayType)).toEqual(['training'])
  })

  it('set gives the same id per (slot, day type) and edits the one row; each write is queued', async () => {
    const db = await newLocalDb()

    const first = await scheduleRepo.set(db, USER_A, 'cardio', 'off', { time: '09:00', reminderEnabled: true }, T0)
    const second = await scheduleRepo.set(db, USER_A, 'cardio', 'off', { time: '09:30', reminderEnabled: false }, new Date(T0.getTime() + 1000))

    expect(second).toBe(first)
    expect(first).toBe(scheduleSlotId(USER_A, 'cardio', 'off'))
    expect(await scheduleRepo.all(db)).toMatchObject([{ id: first, time: '09:30', reminderEnabled: false }])
    const entries = await outbox.due(db, new Date(T0.getTime() + 5000), 500)
    expect(entries.map((e) => e.id)).toEqual([first, first])
    expect(JSON.parse(entries[1]!.payload!)).toEqual({ slot: 'cardio', day_type: 'off', time: '09:30', reminder_enabled: false })
  })

  it('set after a default moves past the defaults timestamp', async () => {
    const db = await newLocalDb()
    await scheduleRepo.ensureDefaults(db, USER_A, null)

    await scheduleRepo.set(db, USER_A, 'checkin', 'off', { time: '22:00', reminderEnabled: true }, T0)

    expect((await scheduleRepo.all(db)).find((s) => s.slot === 'checkin' && s.dayType === 'off')?.clientUpdatedAt).toBe(T0.toISOString())
  })

  it('ids differ by slot, day type and user', () => {
    const id = scheduleSlotId(USER_A, 'meal_1', 'training')
    expect(scheduleSlotId(USER_A, 'meal_1', 'off')).not.toBe(id)
    expect(scheduleSlotId(USER_A, 'meal_2', 'training')).not.toBe(id)
    expect(scheduleSlotId(USER_B, 'meal_1', 'training')).not.toBe(id)
    expect(scheduleSlotId(USER_A, 'meal_1', 'training')).toBe(id)
  })

  it('set refuses what the server would reject', async () => {
    const db = await newLocalDb()

    for (const time of ['7:00', '24:00', '07:00:00', '07:00\n']) {
      await expect(scheduleRepo.set(db, USER_A, 'cardio', 'off', { time, reminderEnabled: true }, T0)).rejects.toThrow(RangeError)
    }
    await expect(scheduleRepo.set(db, USER_A, 'meal 1', 'off', { time: '07:00', reminderEnabled: true }, T0)).rejects.toThrow(RangeError)
    expect(await scheduleRepo.all(db)).toEqual([])
    expect(await outbox.due(db, T0, 500)).toEqual([])
  })

  it('a write that fails to queue leaves no row behind', async () => {
    const db = await newLocalDb()
    vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('disk full'))

    await expect(scheduleRepo.set(db, USER_A, 'cardio', 'off', { time: '09:00', reminderEnabled: true }, T0)).rejects.toThrow('disk full')

    expect(await scheduleRepo.all(db)).toEqual([])
  })

  it('ensureDefaults is all or nothing', async () => {
    const db = await newLocalDb()
    const enqueue = outbox.enqueue.bind(outbox)
    let calls = 0
    vi.spyOn(outbox, 'enqueue').mockImplementation(async (tx, entry) => {
      if (++calls === 5) throw new Error('disk full')
      return enqueue(tx, entry)
    })

    await expect(scheduleRepo.ensureDefaults(db, USER_A, null)).rejects.toThrow('disk full')

    expect(await scheduleRepo.all(db)).toEqual([])
    expect(await outbox.due(db, T0, 500)).toEqual([])
  })
})
