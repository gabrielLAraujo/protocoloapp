import { describe, expect, it, vi } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { checkinParts, dailyCheckinRepo, type EveningFields, type MorningFields } from './dailyCheckinRepo'
import { checkinIdForDate } from './ids'
import { outbox } from './outbox'
import { syncState } from './syncState'

const T0 = new Date('2026-10-18T12:00:00.000Z')
const DATE = '2026-10-18'
const ID = checkinIdForDate(USER_A, DATE)

const morning: MorningFields = { sleepQuality: 4, energyWake: 3, bowel: 'normal', weightKg: 80.4 }
const evening: EveningFields = { energyDay: 4, anxiety: 2, waterL: 2.5, note: 'Dia de teste' }

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
  it('a save writes the row and enqueues the change atomically', async () => {
    const db = await newLocalDb()
    vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('disk full'))

    await expect(dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)).rejects.toThrow('disk full')

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('a save stores the row and queues it under the deterministic id', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)

    expect(await dailyCheckinRepo.get(db, DATE)).toEqual({
      id: ID, date: DATE, ...morning, energyDay: null, anxiety: null, waterL: null, note: null, stress: null, mood: null,
      cardioDone: null, cardioMinutes: null,
      clientUpdatedAt: T0.toISOString(),
    })
    const [entry] = await outbox.due(db, T0, 500)
    expect(entry).toMatchObject({ entity: 'daily_checkin', id: ID, op: 'upsert', clientUpdatedAt: T0.toISOString() })
  })

  it('a second edit updates the row and queues another change', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, { ...morning, energyWake: 5 }, new Date('2026-10-18T12:05:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ energyWake: 5, clientUpdatedAt: '2026-10-18T12:05:00.000Z' })
    expect(await outbox.pendingCount(db)).toBe(2)
  })

  it('a clock that went backwards still produces a newer clientUpdatedAt', async () => {
    // Otherwise the server would see the second edit as older (stale) and the user's last change would be lost.
    const db = await newLocalDb()

    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)
    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, evening, new Date('2026-10-18T11:00:00.000Z'))

    expect((await dailyCheckinRepo.get(db, DATE))?.clientUpdatedAt).toBe('2026-10-18T12:00:00.001Z')
  })

  it('remove soft-deletes and queues a delete', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)

    await dailyCheckinRepo.remove(db, USER_A, DATE, new Date('2026-10-18T12:01:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
    const entries = await outbox.due(db, T0, 500)
    expect(entries.map((e) => [e.op, e.payload])).toEqual([
      ['upsert', expect.any(String)],
      ['delete', null],
    ])
  })

  it('applyRemote reads stress and mood, and a payload without them (older server) as null', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.applyRemote(db, remote())
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ stress: null, mood: null })
    await dailyCheckinRepo.applyRemote(db, remote({ version: 11, payload: { ...remote().payload, stress: 6, mood: 3 } }))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ stress: 6, mood: 3, anxiety: 4 })
  })

  it('applyRemote inserts and updates from the server', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.applyRemote(db, remote({ version: 11, payload: null, deletedAt: '2026-10-18T14:00:00Z', clientUpdatedAt: '2026-10-18T14:00:00Z' }))

    expect(await dailyCheckinRepo.get(db, DATE)).toBeNull()
  })

  it('applyRemote keeps a pending part one version below the record, against an older or a newer remote (until the push answers)', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, new Date('2026-10-18T13:30:00.000Z'))

    // Older remote: the morning is kept, the evening is the server's; one version below (the server's morning clock is
    // not in the record, so a `stale` push must be able to re-pull it).
    await dailyCheckinRepo.applyRemote(db, remote())
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ sleepQuality: 4, anxiety: 4, clientUpdatedAt: '2026-10-18T13:30:00.000Z' })
    expect(await version(db)).toBe(9)

    // Newer remote: same rule.
    await dailyCheckinRepo.applyRemote(db, remote({ version: 12, clientUpdatedAt: '2026-10-18T14:00:00Z' }))
    expect((await dailyCheckinRepo.get(db, DATE))?.sleepQuality).toBe(4)
    expect(await version(db)).toBe(11)

    // Once the change left the outbox (acked), the server's row wins.
    await outbox.ack(db, (await outbox.due(db, T0, 500)).map((e) => e.seq))
    await dailyCheckinRepo.applyRemote(db, remote({ version: 12, clientUpdatedAt: '2026-10-18T14:00:00Z' }))
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ sleepQuality: 2, anxiety: 4, clientUpdatedAt: '2026-10-18T14:00:00.000Z' })
    expect(await version(db)).toBe(12)
  })

  it('a pending part whose time equals the remote clientUpdatedAt is kept, one version below', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, new Date('2026-10-18T13:00:00.000Z'))

    await dailyCheckinRepo.applyRemote(db, remote({ version: 10, clientUpdatedAt: '2026-10-18T13:00:00.000000+00:00' }))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ ...morning, energyDay: 2, anxiety: 4, clientUpdatedAt: '2026-10-18T13:00:00.000Z' })
    expect(await version(db)).toBe(9)
  })

  it('between lists one check-in per date (the newest) inside the range, oldest first', async () => {
    const db = await newLocalDb()
    const other = '7d1f2a10-0000-5000-8000-0000000000aa'
    await dailyCheckinRepo.applyRemote(db, remote({ id: ID, version: 1, clientUpdatedAt: '2026-10-18T10:00:00.000000+00:00' }))
    await dailyCheckinRepo.applyRemote(
      db,
      remote({ id: other, version: 2, clientUpdatedAt: '2026-10-18T14:00:00.000000+00:00', payload: { ...remote().payload, sleep_quality: 5 } }),
    )
    const day2 = '7d1f2a10-0000-5000-8000-0000000000ab'
    await dailyCheckinRepo.applyRemote(db, remote({ id: day2, version: 3, payload: { ...remote().payload, date: '2026-10-19' } }))
    await dailyCheckinRepo.applyRemote(
      db,
      remote({ id: '7d1f2a10-0000-5000-8000-0000000000ac', version: 4, payload: { ...remote().payload, date: '2026-11-30' } }),
    )

    const list = await dailyCheckinRepo.between(db, '2026-10-18', '2026-10-31')

    expect(list.map((c) => c.date)).toEqual(['2026-10-18', '2026-10-19'])
    expect(list[0]!.sleepQuality).toBe(5)
  })
})

const version = async (db: Awaited<ReturnType<typeof newLocalDb>>) =>
  (await db.query<{ version: number | null }>('SELECT version FROM daily_checkins WHERE id = ?', [ID]))[0]?.version

const payloads = async (db: Awaited<ReturnType<typeof newLocalDb>>) =>
  (await outbox.due(db, T0, 500)).map((e) => JSON.parse(e.payload!) as Record<string, unknown>)


describe('dailyCheckinRepo parts', () => {
  it('morning then evening make a complete row, queued as two changes each listing its part', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)
    expect(checkinParts((await dailyCheckinRepo.get(db, DATE))!)).toEqual({ morning: true, evening: false })
    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, evening, new Date('2026-10-18T21:00:00.000Z'))

    const row = await dailyCheckinRepo.get(db, DATE)
    expect(row).toMatchObject({ ...morning, ...evening, cardioDone: null, clientUpdatedAt: '2026-10-18T21:00:00.000Z' })
    expect(checkinParts(row!)).toEqual({ morning: true, evening: true })
    const [first, second] = await payloads(db)
    expect(first).toEqual({
      date: DATE, parts: ['morning'], sleep_quality: 4, energy_wake: 3, bowel: 'normal', weight_kg: 80.4,
      energy_day: null, anxiety: null, water_l: null, note: null, stress: null, mood: null, cardio_done: null, cardio_minutes: null,
    })
    // The whole local row goes along; the server applies only the listed part.
    expect(second).toMatchObject({ parts: ['evening'], sleep_quality: 4, energy_day: 4, anxiety: 2, water_l: 2.5, note: 'Dia de teste' })
  })

  it('editing the morning after the evening keeps the evening', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, evening, T0)

    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, { ...morning, weightKg: null }, new Date('2026-10-18T12:01:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ ...evening, sleepQuality: 4, weightKg: null })
  })

  it('the evening stores and sends stress and mood; omitted they are null', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, { ...evening, stress: 0, mood: 4 }, T0)
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ stress: 0, mood: 4 })
    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, evening, new Date('2026-10-18T12:01:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ stress: null, mood: null })
    const [first, second] = await payloads(db)
    expect(first).toMatchObject({ parts: ['evening'], stress: 0, mood: 4 })
    expect(second).toMatchObject({ parts: ['evening'], stress: null, mood: null })
  })

  it('the water card keeps the meters (the whole evening part goes along)', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, { ...evening, stress: 7, mood: 2 }, T0)

    await dailyCheckinRepo.changeWater(db, USER_A, DATE, (l) => l + 0.5, new Date('2026-10-18T12:01:00.000Z'))

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ waterL: 3, stress: 7, mood: 2 })
    expect((await payloads(db))[1]).toMatchObject({ parts: ['evening'], water_l: 3, stress: 7, mood: 2 })
  })

  it('a check-in without stress and mood still has its evening part', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, evening, T0)

    expect(checkinParts((await dailyCheckinRepo.get(db, DATE))!).evening).toBe(true)
  })

  it('an empty note is stored and sent as null', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.saveEvening(db, USER_A, DATE, { ...evening, note: '  ' }, T0)

    expect((await dailyCheckinRepo.get(db, DATE))?.note).toBeNull()
    expect((await payloads(db))[0]).toMatchObject({ parts: ['evening'], note: null })
  })

  it('cardio without a check-in creates a row with both parts null; done null clears cardio', async () => {
    const db = await newLocalDb()

    await dailyCheckinRepo.setCardio(db, USER_A, DATE, { done: true, minutes: 40 }, T0)
    const row = await dailyCheckinRepo.get(db, DATE)
    expect(row).toMatchObject({ cardioDone: true, cardioMinutes: 40, sleepQuality: null, waterL: null })
    expect(checkinParts(row!)).toEqual({ morning: false, evening: false })

    await dailyCheckinRepo.setCardio(db, USER_A, DATE, { done: false, minutes: 40 }, new Date('2026-10-18T12:01:00.000Z'))
    await dailyCheckinRepo.setCardio(db, USER_A, DATE, { done: null, minutes: null }, new Date('2026-10-18T12:02:00.000Z'))
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ cardioDone: null, cardioMinutes: null })
    expect((await payloads(db)).map((p) => [p.parts, p.cardio_done, p.cardio_minutes])).toEqual([
      [['cardio'], true, 40],
      [['cardio'], false, null],
      [['cardio'], null, null],
    ])
  })

  it('pull merge: a part pending here keeps its local values, the other parts take the server values', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.applyRemote(db, remote({ version: 3, clientUpdatedAt: '2026-10-18T08:00:00Z' }))
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)

    // Another device saved the evening (and cardio) at 11:00; this device's morning (12:00) is still pending.
    await dailyCheckinRepo.applyRemote(
      db,
      remote({
        version: 10,
        clientUpdatedAt: '2026-10-18T11:00:00Z',
        payload: { ...remote().payload, energy_day: 5, anxiety: 1, water_l: 3, note: 'remota', cardio_done: true, cardio_minutes: 20 },
      }),
    )

    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({
      ...morning, energyDay: 5, anxiety: 1, waterL: 3, note: 'remota', cardioDone: true, cardioMinutes: 20,
      // The local clock stays (it is after the remote one), so the next local edit is newer than both.
      clientUpdatedAt: T0.toISOString(),
    })
    expect(await version(db)).toBe(9)
  })

  it('pull merge uses the union of the parts of every pending change; a change without parts (older app) holds all', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)
    await dailyCheckinRepo.setCardio(db, USER_A, DATE, { done: true, minutes: 30 }, new Date('2026-10-18T12:01:00.000Z'))

    await dailyCheckinRepo.applyRemote(db, remote({ payload: { ...remote().payload, cardio_done: false } }))
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ ...morning, cardioDone: true, cardioMinutes: 30, energyDay: 2, anxiety: 4 })

    // A queued change from before the split (no `parts`).
    await outbox.ack(db, (await outbox.due(db, T0, 500)).map((e) => e.seq))
    await outbox.enqueue(db, {
      entity: 'daily_checkin', id: ID, op: 'upsert', payload: JSON.stringify({ date: DATE }), clientUpdatedAt: '2026-10-18T15:00:00.000Z',
    })
    await dailyCheckinRepo.applyRemote(db, remote({ version: 11, payload: { ...remote().payload, sleep_quality: 1, energy_day: 1 } }))
    expect(await dailyCheckinRepo.get(db, DATE)).toMatchObject({ sleepQuality: 4, energyDay: 2, cardioDone: true })
  })

  it('onStale moves the pull cursor back to the row version, never forward', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.applyRemote(db, remote({ version: 10 }))
    await dailyCheckinRepo.saveMorning(db, USER_A, DATE, morning, T0)
    const [entry] = await outbox.due(db, T0, 500)

    await syncState.set(db, 'last_since', '25')
    await dailyCheckinRepo.onStale(db, entry!)
    expect(await syncState.get(db, 'last_since')).toBe('10')

    await syncState.set(db, 'last_since', '4')
    await dailyCheckinRepo.onStale(db, entry!)
    expect(await syncState.get(db, 'last_since')).toBe('4')
  })
})

describe('checkinParts', () => {
  const none = { sleepQuality: null, energyWake: null, bowel: null, energyDay: null, anxiety: null, waterL: null }

  it('a full check-in (as saved before the split) has both parts', () => {
    expect(checkinParts({ ...morning, ...evening })).toEqual({ morning: true, evening: true })
  })

  it('each part needs all its required fields; a cardio-only row has neither', () => {
    expect(checkinParts(none)).toEqual({ morning: false, evening: false })
    expect(checkinParts({ ...none, sleepQuality: 4, energyWake: 3, bowel: 'loose' })).toEqual({ morning: true, evening: false })
    expect(checkinParts({ ...none, energyDay: 2, anxiety: 5, waterL: 0 })).toEqual({ morning: false, evening: true })
    expect(checkinParts({ ...none, sleepQuality: 4, energyWake: 3, energyDay: 2, anxiety: 5 })).toEqual({ morning: false, evening: false })
  })
})
