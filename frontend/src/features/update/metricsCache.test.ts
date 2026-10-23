import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindLocalUser } from '../../data/localUser'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { newLocalDb, newTestApi, USER_A, USER_B } from '../../test/localDb'
import { loadMetrics, metricsCache } from './metricsCache'
import { sampleMetrics } from './testMetrics'

const CYCLE = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-10-20T15:00:00Z')

afterEach(() => vi.unstubAllGlobals())

describe('metricsCache', () => {
  it('stores and reads the metrics of a cycle', async () => {
    const db = await newLocalDb()
    expect(await metricsCache.get(db, CYCLE)).toBeNull()
    await metricsCache.put(db, CYCLE, sampleMetrics(), NOW)
    expect(await metricsCache.get(db, CYCLE)).toEqual({ metrics: sampleMetrics(), fetchedAt: NOW.toISOString() })
  })

  it('ignores a stored value it cannot read', async () => {
    const db = await newLocalDb()
    await db.execute('INSERT INTO kv (key, value) VALUES (?, ?)', [`update_metrics:${CYCLE}`, '{"metrics":{"x":1},"fetchedAt":"x"}'])
    expect(await metricsCache.get(db, CYCLE)).toBeNull()
  })

  it('is wiped when another user signs in', async () => {
    const db = await newLocalDb()
    await bindLocalUser(db, USER_A, [])
    await metricsCache.put(db, CYCLE, sampleMetrics(), NOW)
    await bindLocalUser(db, USER_B, [])
    expect(await metricsCache.get(db, CYCLE)).toBeNull()
  })
})

describe('loadMetrics', () => {
  it('online: fetches, stores and answers fresh metrics', async () => {
    const db = await newLocalDb()
    const calls = mockFetch({ [`GET /api/update-cycles/${CYCLE}/metrics`]: () => json(sampleMetrics()) })
    const loaded = await loadMetrics(db, newTestApi(), CYCLE, NOW)
    expect(loaded).toEqual({ metrics: sampleMetrics(), fetchedAt: NOW.toISOString(), cached: false })
    expect(calls).toHaveLength(1)
    expect((await metricsCache.get(db, CYCLE))?.metrics).toEqual(sampleMetrics())
  })

  it('without a connection: the cached metrics, marked as cached', async () => {
    const db = await newLocalDb()
    await metricsCache.put(db, CYCLE, sampleMetrics(), new Date('2026-10-18T10:00:00Z'))
    mockFetch({}) // every request rejects
    const loaded = await loadMetrics(db, newTestApi(), CYCLE, NOW)
    expect(loaded).toEqual({ metrics: sampleMetrics(), fetchedAt: '2026-10-18T10:00:00.000Z', cached: true })
  })

  it('a server error falls back to the cache; nothing cached is null', async () => {
    const db = await newLocalDb()
    mockFetch({ [`GET /api/update-cycles/${CYCLE}/metrics`]: () => problem(500) })
    expect(await loadMetrics(db, newTestApi(), CYCLE, NOW)).toBeNull()
  })
})
