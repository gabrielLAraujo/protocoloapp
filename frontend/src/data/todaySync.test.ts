import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema'
import type { ProtocolDocument } from '../domain/planDocuments'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi, USER_A } from '../test/localDb'
import { adherenceRepo } from './adherenceRepo'
import { scheduleRepo } from './scheduleRepo'
import { SyncEngine } from './syncEngine'

type SyncChange = components['schemas']['SyncChange']
type SyncRecord = components['schemas']['SyncRecord']

/** A tiny server: last-writer-wins by clientUpdatedAt (not newer → stale), versions in write order, pull since a version. */
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

const protocol: ProtocolDocument = { meals: [{ key: '1', label: '', items: [] }], items: [], guidelines: [] }
const T0 = new Date('2026-10-19T12:00:00.000Z')
const at = (ms: number) => () => new Date(T0.getTime() + ms)

afterEach(() => vi.unstubAllGlobals())

describe('schedule_slot and adherence_log sync', () => {
  it('round-trip: what one device writes another one pulls, deletes included', async () => {
    fakeServer()
    const a = await newLocalDb()
    const b = await newLocalDb()
    await scheduleRepo.ensureDefaults(a, USER_A, protocol)
    await scheduleRepo.set(a, USER_A, 'meal_1', 'off', { time: '08:30', reminderEnabled: false }, T0)
    await adherenceRepo.mark(a, USER_A, { date: '2026-10-19', targetType: 'meal', targetKey: '1', status: 'partial', reason: 'no_time', note: 'Pouco' }, T0)
    await adherenceRepo.mark(a, USER_A, { date: '2026-10-19', targetType: 'cardio', targetKey: 'cardio', status: 'done' }, T0)
    await adherenceRepo.clear(a, USER_A, { date: '2026-10-19', targetType: 'cardio', targetKey: 'cardio' }, new Date(T0.getTime() + 1000))

    expect((await new SyncEngine(a, newTestApi(), at(5000)).runOnce()).rejected).toBe(0)
    await new SyncEngine(b, newTestApi(), at(6000)).runOnce()

    expect(await scheduleRepo.all(b)).toEqual(await scheduleRepo.all(a))
    expect((await scheduleRepo.all(b)).find((s) => s.slot === 'meal_1' && s.dayType === 'off')).toMatchObject({ time: '08:30', reminderEnabled: false })
    expect(await adherenceRepo.between(b, '2026-10-19', '2026-10-19')).toEqual(await adherenceRepo.between(a, '2026-10-19', '2026-10-19'))
    expect(await adherenceRepo.between(b, '2026-10-19', '2026-10-19')).toMatchObject([{ targetKey: '1', status: 'partial', reason: 'no_time', note: 'Pouco' }])
  })

  it('defaults created offline on a second device never overwrite a time set on the first', async () => {
    const server = fakeServer()
    const a = await newLocalDb()
    const b = await newLocalDb()
    await scheduleRepo.set(a, USER_A, 'workout', 'training', { time: '06:00', reminderEnabled: true }, T0)
    await new SyncEngine(a, newTestApi(), at(5000)).runOnce()

    // Device B never pulled: it suggests its own defaults (later device clock), then syncs.
    await scheduleRepo.ensureDefaults(b, USER_A, protocol)
    await new SyncEngine(b, newTestApi(), at(60_000)).runOnce()

    const workout = (await scheduleRepo.all(b)).find((s) => s.slot === 'workout' && s.dayType === 'training')
    expect(workout).toMatchObject({ time: '06:00' })
    const stored = [...server.values()].find((r) => (r.payload as { slot?: string } | null)?.slot === 'workout' && (r.payload as { day_type: string }).day_type === 'training')
    expect(stored?.payload).toMatchObject({ time: '06:00' })
  })
})
