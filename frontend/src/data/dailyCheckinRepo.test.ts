import { describe, expect, it, vi } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { dailyCheckinRepo, StaleCheckinError, type DailyCheckinFields } from './dailyCheckinRepo'
import { checkinIdForDate } from './ids'
import { outbox } from './outbox'

const T0 = new Date('2026-10-18T12:00:00.000Z')
const DATE = '2026-10-18'
const ID = checkinIdForDate(USER_A, DATE)

const fields: DailyCheckinFields = {
  sleepQuality: 4,
  bowel: 'normal',
  energyWake: 3,
  energyDay: 4,
  anxiety: 2,
  waterL: 2.5,
  weightKg: 80.4,
  note: 'Dia de teste',
  cardioDone: true,
  cardioMinutes: 30,
}

const remote = (overrides: Record<string, unknown> = {}) => ({
  entity: 'daily_checkin',
  id: ID,
  version: 10,
  payload: {
    date: DATE,
    sleep_quality: 2,
    bowel: 'loose',
    energy_wake: 2,
    energy_day: 2,
    anxiety: 4,
    water_l: 1.5,
    weight_kg: null,
    note: null,
  },
  deletedAt: null,
  clientUpdatedAt: '2026-10-18T13:00:00.000000+00:00',
  ...overrides,
})

describe('dailyCheckinRepo', () => {
  it('upsert writes row and enqueues outbox atomically', async () => {
    const db = await newLocalDb()
    vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('disk full'))

    await expect(dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0)).rejects.toThrow('disk full')

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('upsert stores the row and queues the snake_case payload under the deterministic id', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0)

    expect(await dailyCheckinRepo.get(db, DATE)).toEqual({ id: ID, date: DATE, ...fields, clientUpdatedAt: T0.toISOString() })
    const [entry] = await outbox.due(db, T0, 500)
    expect(entry).toMatchObject({ entity: 'daily_checkin', id: ID, op: 'upsert', clientUpdatedAt: T0.toISOString() })
    expect(JSON.parse(entry!.payload!)).toEqual({
      date: DATE,
      sleep_quality: 4,
      bowel: 'normal',
      energy_wake: 3,
      energy_day: 4,
      anxiety: 2,
      water_l: 2.5,
      weight_kg: 80.4,
      note: 'Dia de teste',
      cardio_done: true,
      cardio_minutes: 30,
    })
  })

  it('a second edit updates the row and queues another change', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0)
    await dailyCheckinRepo.upsert(db, USER_A, DATE, { ...fields, anxiety: 5 }, new Date('2026-10-18T12:05:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ anxiety: 5, clientUpdatedAt: '2026-10-18T12:05:00.000Z' })
    expect(await outbox.pendingCount(db)).toBe(2)
  })

  it('a clock that went backwards still produces a newer clientUpdatedAt', async () => {
    // Otherwise the server would see the second edit as older (stale) and the user's last change would be lost.
    const db = await newLocalDb()

    await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0)
    await dailyCheckinRepo.upsert(db, USER_A, DATE, { ...fields, anxiety: 5 }, new Date('2026-10-18T11:00:00.000Z'))

    expect((await dailyCheckinRepo.get(db, DATE))?.clientUpdatedAt).toBe('2026-10-18T12:00:00.001Z')
  })

  it('upsert with `expected` refuses to overwrite a row that changed since it was read', async () => {
    const db = await newLocalDb()
    // Nothing was there when the screen loaded, but a pull brought a row in meanwhile.
    await dailyCheckinRepo.applyRemote(db, remote())
    await expect(dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0, { expected: null })).rejects.toBeInstanceOf(StaleCheckinError)
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ note: null, waterL: 1.5 })
    expect(await outbox.pendingCount(db)).toBe(0)

    // With the stamp it really holds, the save goes through and returns the new stamp.
    const loaded = (await dailyCheckinRepo.get(db, DATE))!.clientUpdatedAt
    const stamp = await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0, { expected: loaded })
    expect(stamp > loaded).toBe(true)
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ note: 'Dia de teste', clientUpdatedAt: stamp })
  })

  it('remove soft-deletes and queues a delete', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, T0)

    await dailyCheckinRepo.remove(db, USER_A, DATE, new Date('2026-10-18T12:01:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
    const entries = await outbox.due(db, T0, 500)
    expect(entries.map((e) => [e.op, e.payload])).toEqual([
      ['upsert', expect.any(String)],
      ['delete', null],
    ])
  })

  it('applyRemote inserts and updates from the server', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.applyRemote(db, remote())

    expect(await dailyCheckinRepo.get(db, DATE)).toEqual({
      id: ID,
      date: DATE,
      sleepQuality: 2,
      bowel: 'loose',
      energyWake: 2,
      energyDay: 2,
      anxiety: 4,
      waterL: 1.5,
      weightKg: null,
      note: null,
      cardioDone: null,
      cardioMinutes: null,
      clientUpdatedAt: '2026-10-18T13:00:00.000Z',
    })
  })

  it('applyRemote of a deleted record hides the local row', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.applyRemote(db, remote())

    await dailyCheckinRepo.applyRemote(db, remote({ version: 11, payload: null, deletedAt: '2026-10-18T14:00:00Z', clientUpdatedAt: '2026-10-18T14:00:00Z' }))

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
  })

  it('applyRemote does not overwrite a newer local pending change, but a newer remote wins', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.upsert(db, USER_A, DATE, fields, new Date('2026-10-18T13:30:00.000Z'))

    await dailyCheckinRepo.applyRemote(db, remote())
    expect((await dailyCheckinRepo.get(db, DATE))?.sleepQuality).toBe(4)

    await dailyCheckinRepo.applyRemote(db, remote({ version: 12, clientUpdatedAt: '2026-10-18T14:00:00Z' }))
    expect((await dailyCheckinRepo.get(db, DATE))?.sleepQuality).toBe(2)
  })

  it('cardio is stored, queued, and minutes are dropped unless cardio was done', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.upsert(db, USER_A, DATE, { ...fields, cardioDone: false, cardioMinutes: 45 }, T0)

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ cardioDone: false, cardioMinutes: null })
    const [entry] = await outbox.due(db, T0, 500)
    expect(JSON.parse(entry!.payload!)).toMatchObject({ cardio_done: false, cardio_minutes: null })
  })
})
