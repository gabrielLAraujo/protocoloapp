import { afterEach, describe, expect, it, vi } from 'vitest'
import { newLocalDb, USER_A, USER_B } from '../test/localDb'
import { adherenceLogSync, adherenceRepo } from './adherenceRepo'
import { adherenceLogId } from './ids'
import { outbox } from './outbox'

const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const meal2 = { date: '2026-10-19', targetType: 'meal', targetKey: '2' } as const

afterEach(() => vi.restoreAllMocks())

describe('adherenceRepo', () => {
  it('marking twice upserts the one deterministic id; both writes are queued', async () => {
    const db = await newLocalDb()

    const first = await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'done' }, T0)
    const second = await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'partial', reason: 'no_appetite', note: 'Metade' }, later(1000))

    expect(second).toBe(first)
    expect(first).toBe(adherenceLogId(USER_A, '2026-10-19', 'meal', '2'))
    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([
      { id: first, ...meal2, status: 'partial', reason: 'no_appetite', note: 'Metade', clientUpdatedAt: later(1000).toISOString() },
    ])
    const entries = await outbox.due(db, later(5000), 500)
    expect(entries.map((e) => [e.entity, e.id, e.op])).toEqual([
      ['adherence_log', first, 'upsert'],
      ['adherence_log', first, 'upsert'],
    ])
    expect(JSON.parse(entries[1]!.payload!)).toEqual({
      date: '2026-10-19', target_type: 'meal', target_key: '2', status: 'partial', reason: 'no_appetite', note: 'Metade',
    })
  })

  it('done drops the reason; a blank note is null', async () => {
    const db = await newLocalDb()

    await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'done', reason: 'no_time', note: '  ' }, T0)

    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toMatchObject([{ status: 'done', reason: null, note: null }])
    const [entry] = await outbox.due(db, later(1), 500)
    expect(JSON.parse(entry!.payload!)).toMatchObject({ reason: null, note: null })
  })

  it('refuses what the server would reject, writing nothing', async () => {
    const db = await newLocalDb()

    await expect(adherenceRepo.mark(db, USER_A, { ...meal2, targetKey: 'meal 2', status: 'done' }, T0)).rejects.toThrow(RangeError)
    await expect(adherenceRepo.mark(db, USER_A, { ...meal2, status: 'missed', note: 'x'.repeat(501) }, T0)).rejects.toThrow(RangeError)
    await expect(
      adherenceRepo.mark(db, USER_A, { ...meal2, status: 'missed', reason: 'bored' as unknown as 'other' }, T0),
    ).rejects.toThrow(RangeError)

    expect(await adherenceRepo.between(db, '2026-01-01', '2026-12-31')).toEqual([])
    expect(await outbox.due(db, T0, 500)).toEqual([])
  })

  it('clear soft-deletes and queues the delete; clearing again does nothing; marking again revives the same id', async () => {
    const db = await newLocalDb()
    const id = await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'done' }, T0)

    await adherenceRepo.clear(db, USER_A, meal2, later(1000))
    await adherenceRepo.clear(db, USER_A, meal2, later(2000))

    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([])
    const entries = await outbox.due(db, later(5000), 500)
    expect(entries.map((e) => [e.op, e.payload])).toEqual([
      ['upsert', expect.any(String)],
      ['delete', null],
    ])

    expect(await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'missed', reason: 'no_time' }, later(3000))).toBe(id)
    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toMatchObject([{ id, status: 'missed' }])
  })

  it('clear of a target never marked does nothing', async () => {
    const db = await newLocalDb()

    await adherenceRepo.clear(db, USER_A, meal2, T0)

    expect(await outbox.due(db, later(1), 500)).toEqual([])
  })

  it('ids differ by user, date, type and key', () => {
    const id = adherenceLogId(USER_A, '2026-10-19', 'meal', '2')
    expect(adherenceLogId(USER_B, '2026-10-19', 'meal', '2')).not.toBe(id)
    expect(adherenceLogId(USER_A, '2026-10-20', 'meal', '2')).not.toBe(id)
    expect(adherenceLogId(USER_A, '2026-10-19', 'protocol_item', '2')).not.toBe(id)
    expect(adherenceLogId(USER_A, '2026-10-19', 'meal', '3')).not.toBe(id)
  })

  it('between is inclusive and ordered by date, type and key', async () => {
    const db = await newLocalDb()
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-20', targetType: 'meal', targetKey: '1', status: 'done' }, T0)
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-19', targetType: 'protocol_item', targetKey: 'item_a', status: 'done' }, T0)
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-19', targetType: 'meal', targetKey: '2', status: 'done' }, T0)
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-22', targetType: 'cardio', targetKey: 'cardio', status: 'done' }, T0)

    const found = await adherenceRepo.between(db, '2026-10-19', '2026-10-20')

    expect(found.map((l) => [l.date, l.targetType, l.targetKey])).toEqual([
      ['2026-10-19', 'meal', '2'],
      ['2026-10-19', 'protocol_item', 'item_a'],
      ['2026-10-20', 'meal', '1'],
    ])
  })

  it('a write that fails to queue leaves no row behind', async () => {
    const db = await newLocalDb()
    vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('disk full'))

    await expect(adherenceRepo.mark(db, USER_A, { ...meal2, status: 'done' }, T0)).rejects.toThrow('disk full')

    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([])
  })

  it('a pulled delete hides the mark; a pending newer local mark is not overwritten', async () => {
    const db = await newLocalDb()
    const id = adherenceLogId(USER_A, '2026-10-19', 'meal', '2')
    const payload = { date: '2026-10-19', target_type: 'meal', target_key: '2', status: 'done', reason: null, note: null }
    await adherenceLogSync.applyRemote(db, { entity: 'adherence_log', id, version: 1, payload, deletedAt: null, clientUpdatedAt: '2026-10-19T10:00:00+00:00' })
    await adherenceLogSync.applyRemote(db, {
      entity: 'adherence_log', id, version: 2, payload: null, deletedAt: '2026-10-19T11:00:00+00:00', clientUpdatedAt: '2026-10-19T11:00:00+00:00',
    })
    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([])

    await adherenceRepo.mark(db, USER_A, { ...meal2, status: 'missed', reason: 'felt_sick' }, T0)
    await adherenceLogSync.applyRemote(db, { entity: 'adherence_log', id, version: 3, payload, deletedAt: null, clientUpdatedAt: '2026-10-19T11:30:00+00:00' })

    expect(await adherenceRepo.between(db, '2026-10-19', '2026-10-19')).toMatchObject([{ status: 'missed', reason: 'felt_sick' }])
  })
})
