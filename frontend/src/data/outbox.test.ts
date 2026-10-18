import { describe, expect, it } from 'vitest'
import { newLocalDb } from '../test/localDb'
import { outbox } from './outbox'

const T0 = new Date('2026-10-18T12:00:00.000Z')
const ID = '7d1f2a10-0000-5000-8000-000000000001'

const upsert = (id = ID, at = T0) => ({
  entity: 'daily_checkin',
  id,
  op: 'upsert' as const,
  payload: '{"date":"2026-10-18"}',
  clientUpdatedAt: at.toISOString(),
})

describe('outbox', () => {
  it('returns pending entries in seq order', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert('7d1f2a10-0000-5000-8000-00000000000a'))
    await outbox.enqueue(db, upsert('7d1f2a10-0000-5000-8000-00000000000b'))

    const due = await outbox.due(db, T0, 500)

    expect(due.map((e) => e.id)).toEqual(['7d1f2a10-0000-5000-8000-00000000000a', '7d1f2a10-0000-5000-8000-00000000000b'])
    expect(due[0]).toMatchObject({ op: 'upsert', attempts: 0, status: 'pending', errors: null, payload: '{"date":"2026-10-18"}' })
    expect(due[0]!.seq).toBeLessThan(due[1]!.seq)
    expect(await outbox.pendingCount(db)).toBe(2)
  })

  it('never coalesces an upsert and a later delete of the same id', async () => {
    // A lone delete of an id the server never saw is accepted without a tombstone, and an older upsert from another
    // device could then resurrect it. Both must go, in order.
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    await outbox.enqueue(db, { ...upsert(), op: 'delete', payload: null, clientUpdatedAt: '2026-10-18T12:00:01.000Z' })

    const due = await outbox.due(db, T0, 500)

    expect(due.map((e) => e.op)).toEqual(['upsert', 'delete'])
  })

  it('respects the limit', async () => {
    const db = await newLocalDb()
    for (let i = 0; i < 3; i++) await outbox.enqueue(db, upsert(`7d1f2a10-0000-5000-8000-00000000000${i}`))

    expect(await outbox.due(db, T0, 2)).toHaveLength(2)
  })

  it('fail applies exponential backoff capped at 15 minutes', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    const [entry] = await outbox.due(db, T0, 500)

    for (let i = 0; i < 3; i++) await outbox.fail(db, [entry!.seq], T0)
    let [after] = await outbox.due(db, new Date(T0.getTime() + 3_600_000), 500)
    expect(after).toMatchObject({ attempts: 3, nextAttemptAt: '2026-10-18T12:00:40.000Z' })

    for (let i = 0; i < 10; i++) await outbox.fail(db, [entry!.seq], T0)
    ;[after] = await outbox.due(db, new Date(T0.getTime() + 3_600_000), 500)
    expect(after).toMatchObject({ attempts: 13, nextAttemptAt: '2026-10-18T12:15:00.000Z' })
  })

  it('an entry in backoff holds back the entries queued after it', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    const [head] = await outbox.due(db, T0, 500)
    await outbox.fail(db, [head!.seq], T0)
    await outbox.enqueue(db, { ...upsert(), op: 'delete', payload: null })

    expect(await outbox.due(db, new Date(T0.getTime() + 9_000), 500)).toEqual([])
    expect((await outbox.due(db, new Date(T0.getTime() + 10_000), 500)).map((e) => e.op)).toEqual(['upsert', 'delete'])
  })

  it('ack removes entries', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    const [entry] = await outbox.due(db, T0, 500)

    await outbox.ack(db, [entry!.seq])

    expect(await outbox.pendingCount(db)).toBe(0)
    expect(await outbox.due(db, T0, 500)).toEqual([])
  })

  it('reject moves the entry to the attention list', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    const [entry] = await outbox.due(db, T0, 500)

    await outbox.reject(db, entry!.seq, ['invalid_payload:water_l'])

    expect(await outbox.due(db, T0, 500)).toEqual([])
    expect(await outbox.pendingCount(db)).toBe(0)
    const rejected = await outbox.rejected(db)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ id: ID, status: 'rejected', errors: '["invalid_payload:water_l"]' })
  })

  it('hasPending tells whether an (entity, id) has unsent changes', async () => {
    const db = await newLocalDb()
    expect(await outbox.hasPending(db, 'daily_checkin', ID)).toBe(false)
    await outbox.enqueue(db, upsert())
    expect(await outbox.hasPending(db, 'daily_checkin', ID)).toBe(true)
    expect(await outbox.hasPending(db, 'other', ID)).toBe(false)
  })

  it('retry puts a rejected entry back in the queue, attempts reset', async () => {
    const db = await newLocalDb()
    await outbox.enqueue(db, upsert())
    const [entry] = await outbox.due(db, T0, 500)
    await outbox.fail(db, [entry!.seq], T0)
    await outbox.reject(db, entry!.seq, ['invalid_request'])

    await outbox.retry(db, entry!.seq)

    expect(await outbox.rejected(db)).toEqual([])
    expect(await outbox.due(db, T0, 500)).toEqual([
      expect.objectContaining({ seq: entry!.seq, status: 'pending', attempts: 0, errors: null }),
    ])
  })
})
