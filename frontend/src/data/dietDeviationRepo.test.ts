import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi } from '../test/localDb'
import { dietDeviationRepo, type DietDeviationInput } from './dietDeviationRepo'
import { outbox } from './outbox'
import { SyncEngine } from './syncEngine'

type SyncChange = components['schemas']['SyncChange']
type SyncRecord = components['schemas']['SyncRecord']

const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const inMeal: DietDeviationInput = { date: '2026-10-19', mealKey: '1', time: null, description: 'Biscoito', quantity: '3 unidades' }
const extra: DietDeviationInput = { date: '2026-10-19', mealKey: null, time: '15:30', description: 'Pizza', quantity: null }

afterEach(() => vi.unstubAllGlobals())

/** Last-writer-wins server as in todaySync.test.ts. */
function fakeServer() {
  const records = new Map<string, SyncRecord>()
  let version = 0
  mockFetch({
    'POST /api/sync/push': (call) => {
      const { changes } = JSON.parse(call.body) as { changes: SyncChange[] }
      const results = changes.map((c) => {
        const stored = records.get(c.id)
        if (stored && Date.parse(c.clientUpdatedAt) <= Date.parse(stored.clientUpdatedAt)) return { id: c.id, status: 'stale', errors: null }
        records.set(c.id, {
          entity: c.entity,
          id: c.id,
          version: ++version,
          payload: c.op === 'delete' ? null : c.payload,
          deletedAt: c.op === 'delete' ? c.clientUpdatedAt : null,
          clientUpdatedAt: c.clientUpdatedAt,
        })
        return { id: c.id, status: 'applied', errors: null }
      })
      return json({ results })
    },
    'GET /api/sync/pull': (call) => {
      const since = Number(new URL(call.path, 'http://api.test').searchParams.get('since') ?? 0)
      const page = [...records.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version)
      return json({ records: page, nextSince: page.at(-1)?.version ?? since, hasMore: false })
    },
  })
  return records
}

describe('dietDeviationRepo', () => {
  it('add, update and remove are queued as upsert, upsert, delete', async () => {
    const db = await newLocalDb()

    const id = await dietDeviationRepo.add(db, inMeal, T0)
    await dietDeviationRepo.update(db, id, { ...inMeal, description: '  Chocolate ', quantity: '  ' }, later(1000))

    expect(await dietDeviationRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([
      { id, ...inMeal, description: 'Chocolate', quantity: null, clientUpdatedAt: later(1000).toISOString() },
    ])
    await dietDeviationRepo.remove(db, id, later(2000))
    expect(await dietDeviationRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([])
    const entries = await outbox.due(db, later(5000), 500)
    expect(entries.map((e) => [e.entity, e.id, e.op])).toEqual([
      ['diet_deviation', id, 'upsert'],
      ['diet_deviation', id, 'upsert'],
      ['diet_deviation', id, 'delete'],
    ])
    expect(JSON.parse(entries[1]!.payload!)).toEqual({ date: '2026-10-19', meal_key: '1', time: null, description: 'Chocolate', quantity: null })
  })

  it('lists by date and time, timed first, deleted ones left out', async () => {
    const db = await newLocalDb()
    const a = await dietDeviationRepo.add(db, inMeal, T0)
    const b = await dietDeviationRepo.add(db, extra, later(1))
    const c = await dietDeviationRepo.add(db, { ...extra, time: '09:00' }, later(2))
    const d = await dietDeviationRepo.add(db, { ...extra, date: '2026-10-18' }, later(3))
    await dietDeviationRepo.remove(db, c, later(4))

    expect((await dietDeviationRepo.between(db, '2026-10-18', '2026-10-19')).map((x) => x.id)).toEqual([d, b, a])
  })

  it('refuses what the server would reject, without the text in the message', async () => {
    const db = await newLocalDb()
    const secret = 'x'.repeat(201)

    await expect(dietDeviationRepo.add(db, { ...inMeal, description: '   ' }, T0)).rejects.toThrow(RangeError)
    await expect(dietDeviationRepo.add(db, { ...inMeal, description: secret }, T0)).rejects.toThrow('Invalid description')
    await expect(dietDeviationRepo.add(db, { ...inMeal, quantity: 'q'.repeat(61) }, T0)).rejects.toThrow(RangeError)
    await expect(dietDeviationRepo.add(db, { ...extra, time: '7:00' }, T0)).rejects.toThrow(RangeError)
    await expect(dietDeviationRepo.add(db, { ...inMeal, mealKey: 'meal 1' }, T0)).rejects.toThrow(RangeError)
    await expect(dietDeviationRepo.update(db, 'missing', inMeal, T0)).rejects.toThrow(RangeError)
    expect(await outbox.due(db, later(1), 500)).toEqual([])
    expect(await dietDeviationRepo.between(db, '2026-10-19', '2026-10-19')).toEqual([])
  })

  it('round-trip: what one device adds, edits and deletes reaches the other', async () => {
    fakeServer()
    const a = await newLocalDb()
    const b = await newLocalDb()
    const kept = await dietDeviationRepo.add(a, inMeal, T0)
    const gone = await dietDeviationRepo.add(a, extra, T0)
    await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()
    await new SyncEngine(b, newTestApi(), () => later(2000)).runOnce()
    expect(await dietDeviationRepo.between(b, '2026-10-19', '2026-10-19')).toHaveLength(2)

    await dietDeviationRepo.update(a, kept, { ...inMeal, quantity: '1 pacote' }, later(3000))
    await dietDeviationRepo.remove(a, gone, later(3000))
    expect((await new SyncEngine(a, newTestApi(), () => later(4000)).runOnce()).rejected).toBe(0)
    await new SyncEngine(b, newTestApi(), () => later(5000)).runOnce()

    expect(await dietDeviationRepo.between(b, '2026-10-19', '2026-10-19')).toEqual(await dietDeviationRepo.between(a, '2026-10-19', '2026-10-19'))
    expect(await dietDeviationRepo.between(b, '2026-10-19', '2026-10-19')).toMatchObject([{ id: kept, quantity: '1 pacote' }])
  })
})
