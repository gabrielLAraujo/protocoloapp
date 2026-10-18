import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema'
import { json, mockFetch, problem, type Call } from '../test/fetch-mock'
import { newLocalDb, newTestApi, USER_A } from '../test/localDb'
import { dailyCheckinRepo, dailyCheckinSync, type DailyCheckinFields } from './dailyCheckinRepo'
import { checkinIdForDate } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'
import { SyncEngine, type SyncStatus } from './syncEngine'
import { syncState } from './syncState'

type SyncChange = components['schemas']['SyncChange']
type SyncRecord = components['schemas']['SyncRecord']

const fields: DailyCheckinFields = {
  sleepQuality: 4,
  bowel: 'normal',
  energyWake: 3,
  energyDay: 4,
  anxiety: 2,
  waterL: 2.5,
  weightKg: null,
  note: null,
}

/** A mutable clock the engine reads through `clock()`. */
function testClock(start = '2026-10-18T12:00:00.000Z') {
  let now = new Date(start)
  return {
    clock: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms)
    },
  }
}

const changesOf = (call: Call) => (JSON.parse(call.body) as { changes: SyncChange[] }).changes
const pushes = (calls: Call[]) => calls.filter((c) => c.path === '/api/sync/push')
const pulls = (calls: Call[]) => calls.filter((c) => c.path.startsWith('/api/sync/pull'))
const emptyPull = () => json({ records: [], nextSince: 0, hasMore: false })

async function seed(db: LocalDb, dates: string[], at: Date) {
  for (const date of dates) await dailyCheckinRepo.upsert(db, USER_A, date, fields, at)
}

const remoteRecord = (date: string, version: number, overrides: Partial<SyncRecord> = {}): SyncRecord => ({
  entity: 'daily_checkin',
  id: checkinIdForDate(USER_A, date),
  version,
  payload: {
    date,
    sleep_quality: 1,
    bowel: 'constipated',
    energy_wake: 1,
    energy_day: 1,
    anxiety: 5,
    water_l: 3,
    weight_kg: 81,
    note: 'remoto',
  },
  deletedAt: null,
  clientUpdatedAt: '2026-10-18T11:00:00.000000+00:00',
  ...overrides,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SyncEngine', () => {
  it('pushes due entries and acks applied/stale', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-17', '2026-10-18'], clock())
    const calls = mockFetch({
      'POST /api/sync/push': (call) =>
        json({ results: changesOf(call).map((c, i) => ({ id: c.id, status: i === 0 ? 'applied' : 'stale', errors: null })) }),
      'GET /api/sync/pull': emptyPull,
    })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(result).toEqual({ pushed: 2, pulled: 0, rejected: 0, offline: false })
    expect(await outbox.pendingCount(db)).toBe(0)
    const [change] = changesOf(pushes(calls)[0]!)
    expect(change).toEqual({
      entity: 'daily_checkin',
      id: checkinIdForDate(USER_A, '2026-10-17'),
      op: 'upsert',
      payload: expect.objectContaining({ date: '2026-10-17', sleep_quality: 4, bowel: 'normal', weight_kg: null }),
      clientUpdatedAt: '2026-10-18T12:00:00.000Z',
    })
  })

  it('rejected entries move to attention list and are not retried', async () => {
    const db = await newLocalDb()
    const { clock, advance } = testClock()
    await seed(db, ['2026-10-17', '2026-10-18'], clock())
    const calls = mockFetch({
      'POST /api/sync/push': (call) =>
        json({
          results: changesOf(call).map((c, i) =>
            i === 0
              ? { id: c.id, status: 'rejected', errors: ['client_updated_at_in_future'] }
              : { id: c.id, status: 'applied', errors: null },
          ),
        }),
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    const result = await engine.runOnce()
    advance(3_600_000)
    await engine.runOnce()

    expect(result).toMatchObject({ pushed: 1, rejected: 1, offline: false })
    expect(pushes(calls)).toHaveLength(1)
    const rejected = await outbox.rejected(db)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ id: checkinIdForDate(USER_A, '2026-10-17'), errors: '["client_updated_at_in_future"]' })
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('network error keeps entries and applies backoff', async () => {
    const db = await newLocalDb()
    const { clock, advance } = testClock()
    await seed(db, ['2026-10-18'], clock())
    const calls = mockFetch({
      'POST /api/sync/push': () => {
        throw new TypeError('Failed to fetch')
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    let result
    for (let i = 0; i < 3; i++) {
      result = await engine.runOnce()
      advance(3_600_000)
    }

    expect(result).toEqual({ pushed: 0, pulled: 0, rejected: 0, offline: true })
    // The last failure happened one hour before `clock()`.
    const failedAt = new Date(clock().getTime() - 3_600_000)
    const [entry] = await outbox.due(db, clock(), 500)
    expect(entry).toMatchObject({ attempts: 3, nextAttemptAt: new Date(failedAt.getTime() + 40_000).toISOString() })
    expect(pulls(calls)).toHaveLength(0)

    for (let i = 0; i < 10; i++) {
      await engine.runOnce()
      advance(3_600_000)
    }
    const [capped] = await outbox.due(db, clock(), 500)
    expect(new Date(capped!.nextAttemptAt).getTime() - (clock().getTime() - 3_600_000)).toBe(15 * 60_000)
  })

  it('does not push while the entries are in backoff', async () => {
    const db = await newLocalDb()
    const { clock, advance } = testClock()
    await seed(db, ['2026-10-18'], clock())
    let fail = true
    const calls = mockFetch({
      'POST /api/sync/push': (call) => {
        if (fail) throw new TypeError('Failed to fetch')
        return json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    await engine.runOnce()
    fail = false
    advance(9_000)
    await engine.runOnce()
    expect(pushes(calls)).toHaveLength(1)

    advance(1_000)
    expect(await engine.runOnce()).toMatchObject({ pushed: 1, offline: false })
    expect(pushes(calls)).toHaveLength(2)
  })

  it('an explicit run ignores the backoff', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    let fail = true
    const calls = mockFetch({
      'POST /api/sync/push': (call) => {
        if (fail) throw new TypeError('Failed to fetch')
        return json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    await engine.runOnce()
    fail = false
    // The clock did not move: the entry is still in backoff for a plain run, but not for the user's "sync now".
    expect(await engine.runOnce()).toMatchObject({ pushed: 0 })
    expect(await engine.runOnce({ ignoreBackoff: true })).toMatchObject({ pushed: 1, offline: false })
    expect(pushes(calls)).toHaveLength(2)
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('start: coming back online sends at once, the 60 s tick still waits for the backoff', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    let fail = true
    const calls = mockFetch({
      'POST /api/sync/push': (call) => {
        if (fail) throw new TypeError('Failed to fetch')
        return json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    const stop = engine.start()
    await engine.whenIdle()
    expect(pushes(calls)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await engine.whenIdle()
    expect(pushes(calls)).toHaveLength(1)

    fail = false
    window.dispatchEvent(new Event('online'))
    await engine.whenIdle()
    expect(pushes(calls)).toHaveLength(2)
    expect(await outbox.pendingCount(db)).toBe(0)
    await stop()
  })

  it('entries survive engine crash before ack', async () => {
    const db = await newLocalDb()
    const { clock, advance } = testClock()
    await seed(db, ['2026-10-18'], clock())
    // The fake server keeps what it applied; the first response is lost after the commit.
    const server = new Map<string, string>()
    let lose = true
    const calls = mockFetch({
      'POST /api/sync/push': (call) => {
        const results = changesOf(call).map((c) => {
          const known = server.get(c.id)
          if (known !== undefined && known >= c.clientUpdatedAt) return { id: c.id, status: 'stale', errors: null }
          server.set(c.id, c.clientUpdatedAt)
          return { id: c.id, status: 'applied', errors: null }
        })
        if (lose) {
          lose = false
          throw new TypeError('connection reset')
        }
        return json({ results })
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    expect(await engine.runOnce()).toMatchObject({ offline: true })
    expect(await outbox.pendingCount(db)).toBe(1)

    advance(60_000)
    expect(await engine.runOnce()).toMatchObject({ pushed: 1, offline: false })

    expect(pushes(calls)).toHaveLength(2)
    expect(server.size).toBe(1)
    expect(await outbox.pendingCount(db)).toBe(0)
    expect(await db.query('SELECT id FROM daily_checkins')).toHaveLength(1)
  })

  it('sends an upsert and a later delete of the same id in order, never a lone delete', async () => {
    const db = await newLocalDb()
    const { clock, advance } = testClock()
    await seed(db, ['2026-10-18'], clock())
    advance(1_000)
    await dailyCheckinRepo.remove(db, USER_A, '2026-10-18', clock())
    const calls = mockFetch({
      'POST /api/sync/push': (call) =>
        json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) }),
      'GET /api/sync/pull': emptyPull,
    })

    await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(changesOf(pushes(calls)[0]!).map((c) => c.op)).toEqual(['upsert', 'delete'])
  })

  it('pushes in batches of 500', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    const dates = Array.from({ length: 501 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10))
    await seed(db, dates, clock())
    const calls = mockFetch({
      'POST /api/sync/push': (call) =>
        json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) }),
      'GET /api/sync/pull': emptyPull,
    })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(pushes(calls).map((c) => changesOf(c).length)).toEqual([500, 1])
    expect(result.pushed).toBe(501)
  })

  it('a response that does not match the batch keeps the entries for a retry', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    mockFetch({
      'POST /api/sync/push': () => json({ results: [] }),
      'GET /api/sync/pull': emptyPull,
    })

    await new SyncEngine(db, newTestApi(), clock).runOnce()

    const [entry] = await outbox.due(db, new Date(clock().getTime() + 3_600_000), 500)
    expect(entry).toMatchObject({ attempts: 1 })
  })

  it('pull applies pages until hasMore is false and stores last_since', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    const calls = mockFetch({
      'POST /api/sync/push': () => json({ results: [] }),
      'GET /api/sync/pull': (call) => {
        const since = new URL(call.path, 'http://x').searchParams.get('since')
        if (since === '0') return json({ records: [remoteRecord('2026-10-16', 4), remoteRecord('2026-10-17', 5)], nextSince: 5, hasMore: true })
        if (since === '5') return json({ records: [remoteRecord('2026-10-18', 7)], nextSince: 7, hasMore: false })
        return json({ records: [], nextSince: Number(since), hasMore: false })
      },
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    const result = await engine.runOnce()

    expect(result).toEqual({ pushed: 0, pulled: 3, rejected: 0, offline: false })
    expect(pulls(calls).map((c) => c.path)).toEqual(['/api/sync/pull?since=0&limit=500', '/api/sync/pull?since=5&limit=500'])
    expect(await syncState.get(db, 'last_since')).toBe('7')
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ note: 'remoto', weightKg: 81 })
    expect(pushes(calls)).toHaveLength(0)

    await engine.runOnce()
    expect(pulls(calls).at(-1)?.path).toBe('/api/sync/pull?since=7&limit=500')
  })

  it('remote older than local pending change does not overwrite it', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    // Local edit at 12:00 still pending (in backoff, so this run only pulls); the remote one is from 11:00.
    await seed(db, ['2026-10-18'], clock())
    const [entry] = await outbox.due(db, clock(), 500)
    await outbox.fail(db, [entry!.seq], clock())
    mockFetch({
      'GET /api/sync/pull': () => json({ records: [remoteRecord('2026-10-18', 9)], nextSince: 9, hasMore: false }),
    })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(result).toMatchObject({ pulled: 1, offline: false })
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ sleepQuality: 4, note: null })
    expect(await outbox.pendingCount(db)).toBe(1)
    expect(await syncState.get(db, 'last_since')).toBe('9')
  })

  it('only one run at a time', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    const calls = mockFetch({
      'POST /api/sync/push': async (call) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    const [a, b] = await Promise.all([engine.runOnce(), engine.runOnce()])

    expect(pushes(calls)).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('stops on 401 without backoff and without pulling', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    const calls = mockFetch({
      'POST /api/sync/push': () => problem(401),
      'GET /api/sync/pull': emptyPull,
    })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(result).toEqual({ pushed: 0, pulled: 0, rejected: 0, offline: false })
    expect(pulls(calls)).toHaveLength(0)
    const [entry] = await outbox.due(db, clock(), 500)
    expect(entry).toMatchObject({ attempts: 0 })
  })

  it('server error on push applies backoff', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    mockFetch({ 'POST /api/sync/push': () => problem(503), 'GET /api/sync/pull': emptyPull })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(result.offline).toBe(false)
    expect(await outbox.due(db, clock(), 500)).toEqual([])
  })

  it('a 400 batch is bisected: only the offending entry is rejected, the others are applied', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-16', '2026-10-17', '2026-10-18'], clock())
    const bad = checkinIdForDate(USER_A, '2026-10-17')
    const applied: string[] = []
    const calls = mockFetch({
      'POST /api/sync/push': (call) => {
        const changes = changesOf(call)
        if (changes.some((c) => c.id === bad)) return problem(400)
        applied.push(...changes.map((c) => c.id))
        return json({ results: changes.map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': emptyPull,
    })

    const result = await new SyncEngine(db, newTestApi(), clock).runOnce()

    expect(result).toMatchObject({ pushed: 2, rejected: 1, offline: false })
    expect(applied).toEqual([checkinIdForDate(USER_A, '2026-10-16'), checkinIdForDate(USER_A, '2026-10-18')])
    expect(await outbox.pendingCount(db)).toBe(0)
    const rejected = await outbox.rejected(db)
    expect(rejected.map((e) => [e.id, e.errors])).toEqual([[bad, '["invalid_request"]']])
    expect(pushes(calls).length).toBeGreaterThan(1)
  })

  it('a rejected entry put back with retry() is sent again', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-18'], clock())
    let refuse = true
    const calls = mockFetch({
      'POST /api/sync/push': (call) =>
        refuse
          ? problem(400)
          : json({ results: changesOf(call).map((c) => ({ id: c.id, status: 'applied', errors: null })) }),
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)
    await engine.runOnce()
    const [rejected] = await outbox.rejected(db)

    refuse = false
    await outbox.retry(db, rejected!.seq)
    const result = await engine.runOnce()

    expect(result).toMatchObject({ pushed: 1, rejected: 0 })
    expect(pushes(calls)).toHaveLength(2)
    expect(await outbox.rejected(db)).toEqual([])
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('stop() resolves only after the run in flight has finished', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'GET /api/sync/pull': async () => {
        await held
        return json({ records: [remoteRecord('2026-10-18', 3)], nextSince: 3, hasMore: false })
      },
    })
    const engine = new SyncEngine(db, newTestApi(), clock)

    const stop = engine.start()
    let stopped = false
    const stopping = stop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stopped).toBe(false)

    release()
    await stopping
    // Everything the run wrote is in place before stop() resolves: a wipe after it cannot be undone by this run.
    expect(await syncState.get(db, 'last_since')).toBe('3')
  })

  it('keeps records of entities it does not know yet and applies them once it does', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    mockFetch({
      'GET /api/sync/pull': (call) =>
        call.path.includes('since=0')
          ? json({ records: [remoteRecord('2026-10-18', 3)], nextSince: 3, hasMore: false })
          : json({ records: [], nextSince: 3, hasMore: false }),
    })

    await new SyncEngine(db, newTestApi(), clock, []).runOnce()
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()
    expect(await syncState.get(db, 'last_since')).toBe('3')

    await new SyncEngine(db, newTestApi(), clock, [dailyCheckinSync]).runOnce()
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ note: 'remoto' })
    expect(await db.query('SELECT * FROM sync_unknown')).toEqual([])
  })

  it('subscribe reports pending, rejected, running and lastSyncAt', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    await seed(db, ['2026-10-17', '2026-10-18'], clock())
    mockFetch({
      'POST /api/sync/push': (call) =>
        json({
          results: changesOf(call).map((c, i) =>
            i === 0 ? { id: c.id, status: 'rejected', errors: ['invalid_payload:water_l'] } : { id: c.id, status: 'applied', errors: null },
          ),
        }),
      'GET /api/sync/pull': emptyPull,
    })
    const engine = new SyncEngine(db, newTestApi(), clock)
    const seen: SyncStatus[] = []
    const unsubscribe = engine.subscribe((s) => seen.push(s))

    await engine.runOnce()
    unsubscribe()

    expect(seen.some((s) => s.running)).toBe(true)
    expect(seen.at(-1)).toEqual({
      pending: 0,
      rejected: 1,
      running: false,
      lastSyncAt: '2026-10-18T12:00:00.000Z',
      lastError: null,
      dataVersion: 0,
    })
  })

  it('dataVersion is bumped only when a pull page writes records', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    let page = 0
    mockFetch({
      'GET /api/sync/pull': () => {
        page++
        if (page === 1) return json({ records: [remoteRecord('2026-10-18', 1)], nextSince: 1, hasMore: true })
        if (page === 2) return json({ records: [remoteRecord('2026-10-17', 2)], nextSince: 2, hasMore: false })
        return json({ records: [], nextSince: 2, hasMore: false })
      },
    })
    const engine = new SyncEngine(db, newTestApi(), clock)
    const seen: SyncStatus[] = []
    engine.subscribe((s) => seen.push(s))

    await engine.runOnce()
    expect(seen.at(-1)?.dataVersion).toBe(2)

    await engine.runOnce()
    expect(seen.at(-1)?.dataVersion).toBe(2)
  })

  it('lastError: network when offline, server on 5xx, cleared by a complete run', async () => {
    const db = await newLocalDb()
    const { clock } = testClock()
    let mode: 'offline' | 'down' | 'up' = 'offline'
    mockFetch({
      'GET /api/sync/pull': () => {
        if (mode === 'offline') throw new TypeError('Failed to fetch')
        if (mode === 'down') return problem(503)
        return emptyPull()
      },
    })
    const engine = new SyncEngine(db, newTestApi(), clock)
    let last: SyncStatus | undefined
    engine.subscribe((s) => (last = s))

    await engine.runOnce()
    expect(last).toMatchObject({ lastError: 'network', running: false })
    expect(last?.lastSyncAt).toBeUndefined()

    mode = 'down'
    await engine.runOnce()
    expect(last).toMatchObject({ lastError: 'server' })

    mode = 'up'
    await engine.runOnce()
    expect(last).toMatchObject({ lastError: null, lastSyncAt: '2026-10-18T12:00:00.000Z' })
  })

  it('start runs now, every 60 s and when the device comes back online; stop ends it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const db = await newLocalDb()
    const { clock } = testClock()
    const calls = mockFetch({ 'GET /api/sync/pull': emptyPull })
    const engine = new SyncEngine(db, newTestApi(), clock)
    const settle = () => engine.whenIdle()

    const stop = engine.start()
    await settle()
    expect(pulls(calls)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(pulls(calls)).toHaveLength(2)

    window.dispatchEvent(new Event('online'))
    await settle()
    expect(pulls(calls)).toHaveLength(3)

    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(pulls(calls)).toHaveLength(3)
  })
})
