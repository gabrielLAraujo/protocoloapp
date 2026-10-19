import { describe, expect, it } from 'vitest'
import { newLocalDb, USER_A, USER_B } from '../test/localDb'
import { rotationOverrideIdForDate } from './ids'
import { outbox } from './outbox'
import { rotationOverrideRepo, rotationOverrideSync } from './rotationOverrideRepo'

const T0 = new Date('2026-10-18T12:00:00.000Z')

describe('rotationOverrideRepo', () => {
  it('the same date gives the same id and edits the one override', async () => {
    const db = await newLocalDb()

    const first = await rotationOverrideRepo.set(db, USER_A, '2026-10-20', 'a', T0)
    const second = await rotationOverrideRepo.set(db, USER_A, '2026-10-20', 'off', new Date(T0.getTime() + 1000))

    expect(second).toBe(first)
    expect(first).toBe(rotationOverrideIdForDate(USER_A, '2026-10-20'))
    expect(await rotationOverrideRepo.between(db, '2026-10-01', '2026-10-31')).toMatchObject([{ id: first, date: '2026-10-20', dayKey: 'off' }])
    const entries = await outbox.due(db, new Date(T0.getTime() + 5000), 500)
    expect(entries.map((e) => e.id)).toEqual([first, first])
    expect(JSON.parse(entries[1]!.payload!)).toEqual({ date: '2026-10-20', workout_day_key: 'off' })
  })

  it('ids differ by date and by user', () => {
    expect(rotationOverrideIdForDate(USER_A, '2026-10-20')).not.toBe(rotationOverrideIdForDate(USER_A, '2026-10-21'))
    expect(rotationOverrideIdForDate(USER_A, '2026-10-20')).not.toBe(rotationOverrideIdForDate(USER_B, '2026-10-20'))
  })

  it('between is inclusive and ordered; pulled overrides are stored', async () => {
    const db = await newLocalDb()
    await rotationOverrideRepo.set(db, USER_A, '2026-10-22', 'b', T0)
    await rotationOverrideRepo.set(db, USER_A, '2026-10-20', 'a', T0)
    await rotationOverrideSync.applyRemote(db, {
      entity: 'rotation_override',
      id: rotationOverrideIdForDate(USER_A, '2026-10-25'),
      version: 4,
      payload: { date: '2026-10-25', workout_day_key: 'c' },
      deletedAt: null,
      clientUpdatedAt: '2026-10-18T13:00:00+00:00',
    })

    const found = await rotationOverrideRepo.between(db, '2026-10-20', '2026-10-25')

    expect(found.map((o) => [o.date, o.dayKey])).toEqual([['2026-10-20', 'a'], ['2026-10-22', 'b'], ['2026-10-25', 'c']])
    expect(await rotationOverrideRepo.between(db, '2026-10-21', '2026-10-24')).toHaveLength(1)
  })
})
