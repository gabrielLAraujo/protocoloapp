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

type Entry = { text: string | null; at: string }
type Photo = { pose: string; file_id: string; taken_at: string; updated_at?: string }
const RANK: Record<string, number> = { collecting: 0, draft: 1, sent: 2 }
const isNewer = (a: string, b: string) => Date.parse(a) > Date.parse(b)

/**
 * The server's side of update_cycle: it creates the cycles, a push of an unknown id is read_only, a push keeps the
 * server's protocol and period, and (like UpdateCycleSyncHandler) merges per answer key and per pose, each with its own
 * clock; the status only moves forward. A change with nothing newer is stale.
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
        const pushed = c.payload as Payload
        const kept = stored.payload as Payload
        const entries = { ...(kept.answer_entries as Record<string, Entry>) }
        let changed = false
        for (const [key, e] of Object.entries((pushed.answer_entries ?? {}) as Record<string, Entry>)) {
          if (!entries[key] || isNewer(e.at, entries[key].at)) {
            entries[key] = e
            changed = true
          }
        }
        const photos = new Map((kept.photos as Photo[]).map((x) => [x.pose, x]))
        for (const x of (pushed.photos ?? []) as Photo[]) {
          const old = photos.get(x.pose)
          if (!old || isNewer(x.updated_at ?? c.clientUpdatedAt, old.updated_at ?? stored.clientUpdatedAt)) {
            photos.set(x.pose, x)
            changed = true
          }
        }
        const status = RANK[pushed.status as string]! > RANK[kept.status as string]! ? (pushed.status as string) : (kept.status as string)
        if (status !== kept.status) changed = true
        if (!changed) return { id: c.id, status: 'stale', errors: null }
        records.set(c.id, {
          ...stored,
          version: ++version,
          payload: {
            ...kept,
            status,
            answers: Object.fromEntries(Object.entries(entries).flatMap(([k, e]) => (e.text === null ? [] : [[k, e.text]]))),
            answer_entries: entries,
            photos: [...photos.values()],
            sent_at: status === 'sent' ? (kept.sent_at ?? pushed.sent_at ?? c.clientUpdatedAt) : null,
          },
          clientUpdatedAt: isNewer(c.clientUpdatedAt, stored.clientUpdatedAt) ? c.clientUpdatedAt : stored.clientUpdatedAt,
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
        payload: serverPayload({ answer_entries: {}, ...over }),
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
async function seed(db: LocalDb, id = CYCLE, over: Payload = {}, version = 1, clientUpdatedAt = '2026-10-19T10:00:00.000000+00:00') {
  await db.transaction((tx) =>
    updateCycleSync.applyRemote(tx, {
      entity: 'update_cycle',
      id,
      version,
      payload: serverPayload(over),
      deletedAt: null,
      clientUpdatedAt,
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
    expect(JSON.parse(entries[0]!.payload!)).toEqual(
      serverPayload({
        status: 'draft',
        answers: { week_notes: 'Semana de exemplo tranquila.' },
        answer_entries: { week_notes: { text: 'Semana de exemplo tranquila.', at: T0.toISOString() } },
      }),
    )
    // The removal is an entry too (null text with its clock), so it wins over an older text on another device.
    expect(JSON.parse(entries[2]!.payload!)).toMatchObject({
      answers: { week_notes: 'Semana de exemplo tranquila.' },
      answer_entries: { week_notes: { text: 'Semana de exemplo tranquila.', at: T0.toISOString() }, weight: { text: null, at: later(2).toISOString() } },
    })
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
        { pose: 'back', file_id: FILE_2, taken_at: T0.toISOString(), updated_at: later(1).toISOString() },
        { pose: 'front', file_id: FILE_2, taken_at: later(2).toISOString(), updated_at: later(2).toISOString() },
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

describe('updateCycleRepo.current on ties', () => {
  const OTHER_PROTOCOL = '5b0f7c1e-1d2a-4b3c-8d4e-0000000000bb'

  it('prefers the cycle of the active protocol, even with an older period_start', async () => {
    const db = await newLocalDb()
    await db.execute(
      `INSERT INTO plan_versions (id, kind, status, document, activated_at, client_updated_at, version)
       VALUES (?, 'protocol', 'active', '{}', '2026-10-05T12:00:00.000Z', '2026-10-05T12:00:00.000Z', 1)`,
      [PROTOCOL],
    )
    await seed(db, CYCLE, { period_start: '2026-10-05' }, 1)
    await seed(db, OLD_CYCLE, { protocol_version_id: OTHER_PROTOCOL, period_start: '2026-10-06' }, 2)

    expect((await updateCycleRepo.current(db))?.id).toBe(CYCLE)
  })

  it('without an active protocol, the same period_start goes to the most recently changed, then the higher version', async () => {
    const db = await newLocalDb()
    await seed(db, CYCLE, { period_start: '2026-10-05' }, 1, '2026-10-19T10:00:00.000000+00:00')
    await seed(db, OLD_CYCLE, { protocol_version_id: OTHER_PROTOCOL, period_start: '2026-10-05' }, 2, '2026-10-19T11:00:00.000000+00:00')
    expect((await updateCycleRepo.current(db))?.id).toBe(OLD_CYCLE)

    const tie = await newLocalDb()
    await seed(tie, CYCLE, { period_start: '2026-10-05' }, 1)
    await seed(tie, OLD_CYCLE, { protocol_version_id: OTHER_PROTOCOL, period_start: '2026-10-05' }, 2)
    expect((await updateCycleRepo.current(tie))?.id).toBe(OLD_CYCLE)
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

  it('a pulled record keeps a pending edit and brings the server fields', async () => {
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

    expect(await updateCycleRepo.byId(db, CYCLE)).toMatchObject({ answers: { week_notes: 'Pendente' }, periodEnd: '2026-11-02' })
  })

  it('two devices editing different questions and poses offline: both survive on both', async () => {
    const server = fakeServer()
    server.create(CYCLE)
    const a = await newLocalDb()
    const b = await newLocalDb()
    await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()
    await new SyncEngine(b, newTestApi(), () => later(1000)).runOnce()

    await updateCycleRepo.setAnswer(a, CYCLE, 'week_notes', 'Do aparelho A', later(2000))
    await updateCycleRepo.setPhoto(a, CYCLE, { pose: 'front', fileId: FILE_1, takenAt: later(2000).toISOString() }, later(2001))
    await updateCycleRepo.setAnswer(b, CYCLE, 'sleep', 'Do aparelho B', later(3000))
    await updateCycleRepo.setPhoto(b, CYCLE, { pose: 'back', fileId: FILE_2, takenAt: later(3000).toISOString() }, later(3001))

    // B pushes after A, with newer row clocks: whole-row LWW would drop A's answer and photo.
    expect((await new SyncEngine(a, newTestApi(), () => later(4000)).runOnce()).rejected).toBe(0)
    expect((await new SyncEngine(b, newTestApi(), () => later(5000)).runOnce()).rejected).toBe(0)
    await new SyncEngine(a, newTestApi(), () => later(6000)).runOnce()

    for (const db of [a, b]) {
      const cycle = await updateCycleRepo.byId(db, CYCLE)
      expect(cycle?.answers).toEqual({ week_notes: 'Do aparelho A', sleep: 'Do aparelho B' })
      expect(cycle?.photos.map((p) => [p.pose, p.fileId]).sort()).toEqual([
        ['back', FILE_2],
        ['front', FILE_1],
      ])
    }
  })

  it('the same question on two devices: the newer edit wins, even when it reaches the server first', async () => {
    const server = fakeServer()
    server.create(CYCLE)
    const a = await newLocalDb()
    const b = await newLocalDb()
    await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()
    await new SyncEngine(b, newTestApi(), () => later(1000)).runOnce()

    await updateCycleRepo.setAnswer(a, CYCLE, 'week_notes', 'Mais antiga', later(2000))
    await updateCycleRepo.setAnswer(b, CYCLE, 'week_notes', 'Mais nova', later(3000))
    await updateCycleRepo.setAnswer(a, CYCLE, 'sleep', 'Outra de A', later(1500))

    await new SyncEngine(b, newTestApi(), () => later(4000)).runOnce()
    await new SyncEngine(a, newTestApi(), () => later(5000)).runOnce()
    await new SyncEngine(b, newTestApi(), () => later(6000)).runOnce()

    for (const db of [a, b]) expect((await updateCycleRepo.byId(db, CYCLE))?.answers).toEqual({ week_notes: 'Mais nova', sleep: 'Outra de A' })
  })

  it('a newer removal on one device wins over an older text on the other', async () => {
    const server = fakeServer()
    server.create(CYCLE)
    const a = await newLocalDb()
    const b = await newLocalDb()
    await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()
    await updateCycleRepo.setAnswer(a, CYCLE, 'weight', 'Editado', later(2000))
    await new SyncEngine(a, newTestApi(), () => later(2500)).runOnce()
    await new SyncEngine(b, newTestApi(), () => later(3000)).runOnce()

    await updateCycleRepo.setAnswer(b, CYCLE, 'weight', null, later(4000))
    await new SyncEngine(b, newTestApi(), () => later(5000)).runOnce()
    await new SyncEngine(a, newTestApi(), () => later(6000)).runOnce()

    expect((await updateCycleRepo.byId(a, CYCLE))?.answers).toEqual({})
  })

  it('reads the older stored shapes (answers as key -> text, photos without a clock)', async () => {
    const db = await newLocalDb()
    await db.execute(
      `INSERT INTO update_cycles (id, protocol_version_id, period_start, period_end, status, answers, photos, sent_at, client_updated_at, version)
       VALUES (?, ?, '2026-10-05', '2026-10-26', 'draft', ?, ?, NULL, '2026-10-19T10:00:00.000Z', 1)`,
      [CYCLE, PROTOCOL, JSON.stringify({ week_notes: 'Antiga' }), JSON.stringify([{ pose: 'front', fileId: FILE_1, takenAt: T0.toISOString() }])],
    )

    expect(await updateCycleRepo.byId(db, CYCLE)).toMatchObject({ answers: { week_notes: 'Antiga' }, photos: [{ pose: 'front', fileId: FILE_1 }] })
    await updateCycleRepo.setAnswer(db, CYCLE, 'sleep', 'Nova', T0)
    const [entry] = await outbox.due(db, later(10), 500)
    expect(JSON.parse(entry!.payload!)).toMatchObject({
      answer_entries: { week_notes: { text: 'Antiga', at: '2026-10-19T10:00:00.000Z' }, sleep: { text: 'Nova', at: T0.toISOString() } },
      photos: [{ pose: 'front', file_id: FILE_1, updated_at: '2026-10-19T10:00:00.000Z' }],
    })
  })
})
