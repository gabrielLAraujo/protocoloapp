import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi } from '../test/localDb'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'
import { SyncEngine } from './syncEngine'
import { updateCycleRepo, updateCycleSync } from './updateCycleRepo'

type SyncChange = components['schemas']['SyncChange']
type SyncRecord = components['schemas']['SyncRecord']

const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const CYCLE = '5b0f7c1e-1d2a-4b3c-8d4e-000000000001'
const OLD_CYCLE = '5b0f7c1e-1d2a-4b3c-8d4e-000000000002'
const PROTOCOL = '5b0f7c1e-1d2a-4b3c-8d4e-0000000000aa'
const FILE_1 = '5b0f7c1e-1d2a-4b3c-8d4e-0000000000f1'
const FILE_2 = '5b0f7c1e-1d2a-4b3c-8d4e-0000000000f2'

type Payload = Record<string, unknown>

const serverPayload = (over: Payload = {}): Payload => ({
  protocol_version_id: PROTOCOL,
  period_start: '2026-10-05',
  period_end: '2026-10-26',
  status: 'collecting',
  answers: {},
  photos: [],
  sent_at: null,
  ...over,
})

/**
 * The server's side of update_cycle: it creates the cycles, a push of an unknown id is read_only, a push keeps the
 * server's protocol and period, and a change of dates keeps the stored clientUpdatedAt (so a pending edit still wins).
 */
function fakeServer() {
  const records = new Map<string, SyncRecord>()
  let version = 0
  const pushes: SyncChange[] = []
  mockFetch({
    'POST /api/sync/push': (call) => {
      const { changes } = JSON.parse(call.body) as { changes: SyncChange[] }
      pushes.push(...changes)
      const results = changes.map((c) => {
        const stored = records.get(c.id)
        if (!stored) return { id: c.id, status: 'rejected', errors: ['read_only'] }
        if (Date.parse(c.clientUpdatedAt) <= Date.parse(stored.clientUpdatedAt)) return { id: c.id, status: 'stale', errors: null }
        const pushed = c.payload as Payload
        const kept = stored.payload as Payload
        records.set(c.id, {
          ...stored,
          version: ++version,
          payload: {
            ...pushed,
            protocol_version_id: kept.protocol_version_id,
            period_start: kept.period_start,
            period_end: kept.period_end,
          },
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
  return {
    records,
    pushes,
    create(id: string, over: Payload = {}, at = T0) {
      records.set(id, {
        entity: 'update_cycle',
        id,
        version: ++version,
        payload: serverPayload(over),
        deletedAt: null,
        clientUpdatedAt: at.toISOString(),
      })
    },
    changeDates(id: string, periodEnd: string) {
      const stored = records.get(id)!
      records.set(id, { ...stored, version: ++version, payload: { ...(stored.payload as Payload), period_end: periodEnd } })
    },
  }
}

/** A cycle pulled into the local database, without any server. */
async function seed(db: LocalDb, id = CYCLE, over: Payload = {}, version = 1) {
  await db.transaction((tx) =>
    updateCycleSync.applyRemote(tx, {
      entity: 'update_cycle',
      id,
      version,
      payload: serverPayload(over),
      deletedAt: null,
      clientUpdatedAt: '2026-10-19T10:00:00.000000+00:00',
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('updateCycleRepo', () => {
  it('reads a pulled cycle', async () => {
    const db = await newLocalDb()
    await seed(db, CYCLE, { photos: [{ pose: 'front', file_id: FILE_1, taken_at: '2026-10-19T09:00:00+00:00' }] })

    expect(await updateCycleRepo.byId(db, CYCLE)).toEqual({
      id: CYCLE,
      protocolVersionId: PROTOCOL,
      periodStart: '2026-10-05',
      periodEnd: '2026-10-26',
      status: 'collecting',
      answers: {},
      photos: [{ pose: 'front', fileId: FILE_1, takenAt: '2026-10-19T09:00:00.000Z' }],
      sentAt: null,
      clientUpdatedAt: '2026-10-19T10:00:00.000Z',
    })
  })

  it('setAnswer queues the full payload and turns collecting into draft; null removes the key', async () => {
    const db = await newLocalDb()
    await seed(db)

    await updateCycleRepo.setAnswer(db, CYCLE, 'week_notes', 'Semana de exemplo tranquila.', T0)
    await updateCycleRepo.setAnswer(db, CYCLE, 'weight', 'Editado', later(1))
    await updateCycleRepo.setAnswer(db, CYCLE, 'weight', null, later(2))

    const cycle = await updateCycleRepo.byId(db, CYCLE)
    expect(cycle).toMatchObject({ status: 'draft', answers: { week_notes: 'Semana de exemplo tranquila.' }, clientUpdatedAt: later(2).toISOString() })
    const entries = await outbox.due(db, later(10), 500)
    expect(entries.map((e) => [e.entity, e.id, e.op])).toEqual([
      ['update_cycle', CYCLE, 'upsert'],
      ['update_cycle', CYCLE, 'upsert'],
      ['update_cycle', CYCLE, 'upsert'],
    ])
    expect(JSON.parse(entries[0]!.payload!)).toEqual(serverPayload({ status: 'draft', answers: { week_notes: 'Semana de exemplo tranquila.' } }))
    expect(JSON.parse(entries[2]!.payload!)).toMatchObject({ answers: { week_notes: 'Semana de exemplo tranquila.' } })
  })

  it('setPhoto replaces the photo of the same pose', async () => {
    const db = await newLocalDb()
    await seed(db)

    await updateCycleRepo.setPhoto(db, CYCLE, { pose: 'front', fileId: FILE_1, takenAt: T0.toISOString() }, T0)
    await updateCycleRepo.setPhoto(db, CYCLE, { pose: 'back', fileId: FILE_2, takenAt: T0.toISOString() }, later(1))
    await updateCycleRepo.setPhoto(db, CYCLE, { pose: 'front', fileId: FILE_2, takenAt: later(2).toISOString() }, later(2))

    const cycle = await updateCycleRepo.byId(db, CYCLE)
    expect(cycle?.photos).toEqual([
      { pose: 'back', fileId: FILE_2, takenAt: T0.toISOString() },
      { pose: 'front', fileId: FILE_2, takenAt: later(2).toISOString() },
    ])
    const last = (await outbox.due(db, later(10), 500)).at(-1)!
    expect(JSON.parse(last.payload!)).toMatchObject({
      photos: [
        { pose: 'back', file_id: FILE_2, taken_at: T0.toISOString() },
        { pose: 'front', file_id: FILE_2, taken_at: later(2).toISOString() },
      ],
    })
  })

  it('markSent stores the final answers, the status and the time', async () => {
    const db = await newLocalDb()
    await seed(db)

    await updateCycleRepo.markSent(db, CYCLE, { weight: 'Calculado' }, T0)

    expect(await updateCycleRepo.byId(db, CYCLE)).toMatchObject({ status: 'sent', answers: { weight: 'Calculado' }, sentAt: T0.toISOString() })
  })

  it('never creates a cycle and refuses what the server would reject, without the text in the message', async () => {
    const db = await newLocalDb()
    await seed(db)
    const secret = 'x'.repeat(4001)

    await expect(updateCycleRepo.setAnswer(db, 'unknown', 'a', 'b', T0)).rejects.toThrow('Unknown update cycle')
    await expect(updateCycleRepo.setAnswer(db, CYCLE, 'A b', 'texto', T0)).rejects.toThrow(RangeError)
    await expect(updateCycleRepo.setAnswer(db, CYCLE, 'ok', secret, T0)).rejects.toThrow('Invalid answer')
    await expect(updateCycleRepo.setPhoto(db, CYCLE, { pose: 'Frente', fileId: FILE_1, takenAt: T0.toISOString() }, T0)).rejects.toThrow(RangeError)
    expect(await outbox.due(db, later(1), 500)).toEqual([])
    expect(await updateCycleRepo.byId(db, 'unknown')).toBeNull()
  })

  it('current is the latest period_start; previous the one before', async () => {
    const db = await newLocalDb()
    expect(await updateCycleRepo.current(db)).toBeNull()
    await seed(db, OLD_CYCLE, { period_start: '2026-09-14', period_end: '2026-10-05', status: 'sent' })
    await seed(db, CYCLE)

    expect((await updateCycleRepo.current(db))?.id).toBe(CYCLE)
    expect((await updateCycleRepo.previous(db, CYCLE))?.id).toBe(OLD_CYCLE)
    expect(await updateCycleRepo.previous(db, OLD_CYCLE)).toBeNull()
  })
})

describe('update_cycle sync', () => {
  it('round-trip: an answer given on one device reaches the other', async () => {
    const server = fakeServer()
    server.create(CYCLE)
    const a = await newLocalDb()
    const b = await newLocalDb()
    await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()
    expect(await updateCycleRepo.current(a)).toMatchObject({ id: CYCLE, status: 'collecting' })

    await updateCycleRepo.setAnswer(a, CYCLE, 'week_notes', 'Resposta fictícia', later(2000))
    expect((await new SyncEngine(a, newTestApi(), () => later(3000)).runOnce()).rejected).toBe(0)
    await new SyncEngine(b, newTestApi(), () => later(4000)).runOnce()

    expect(await updateCycleRepo.byId(b, CYCLE)).toEqual(await updateCycleRepo.byId(a, CYCLE))
    expect(await updateCycleRepo.byId(b, CYCLE)).toMatchObject({ status: 'draft', answers: { week_notes: 'Resposta fictícia' } })
  })

  it('a pending edit survives the server changing period_end, and the new date arrives too', async () => {
    const server = fakeServer()
    server.create(CYCLE)
    const db = await newLocalDb()
    await new SyncEngine(db, newTestApi(), () => later(1000)).runOnce()

    // Offline edit, then the cycle dates change on the server (clientUpdatedAt kept, older than the edit).
    await updateCycleRepo.setAnswer(db, CYCLE, 'week_notes', 'Editada offline', later(2000))
    server.changeDates(CYCLE, '2026-11-02')

    const result = await new SyncEngine(db, newTestApi(), () => later(3000)).runOnce()
    expect(result.rejected).toBe(0)
    await new SyncEngine(db, newTestApi(), () => later(4000)).runOnce()

    expect(await outbox.pendingCount(db)).toBe(0)
    expect(await updateCycleRepo.byId(db, CYCLE)).toMatchObject({ periodEnd: '2026-11-02', answers: { week_notes: 'Editada offline' } })
    expect(server.records.get(CYCLE)?.payload).toMatchObject({ period_end: '2026-11-02', answers: { week_notes: 'Editada offline' } })
  })

  it('a pulled record does not overwrite a newer pending edit', async () => {
    const db = await newLocalDb()
    await seed(db)
    await updateCycleRepo.setAnswer(db, CYCLE, 'week_notes', 'Pendente', T0)

    await db.transaction((tx) =>
      updateCycleSync.applyRemote(tx, {
        entity: 'update_cycle',
        id: CYCLE,
        version: 2,
        payload: serverPayload({ period_end: '2026-11-02' }),
        deletedAt: null,
        clientUpdatedAt: '2026-10-19T10:00:00.000000+00:00',
      }),
    )

    expect(await updateCycleRepo.byId(db, CYCLE)).toMatchObject({ answers: { week_notes: 'Pendente' }, periodEnd: '2026-10-26' })
  })
})
