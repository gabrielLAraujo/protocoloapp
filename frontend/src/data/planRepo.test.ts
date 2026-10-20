import { describe, expect, it } from 'vitest'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi } from '../test/localDb'
import type { SyncRecord } from './apiClient'
import { exerciseRepo, exerciseSync } from './exerciseRepo'
import { planRepo, planVersionSync } from './planRepo'
import { SyncEngine } from './syncEngine'

const PLAN_ID = '7d1f2a10-0000-5000-8000-0000000000a1'
const OLD_ID = '7d1f2a10-0000-5000-8000-0000000000a2'
const EX_ID = '7d1f2a10-0000-5000-8000-0000000000e1'

const planRecord = (id: string, status: string, version: number, overrides: Partial<SyncRecord> = {}): SyncRecord => ({
  entity: 'plan_version',
  id,
  version,
  payload: {
    kind: 'workout',
    status,
    document: { rotation: { type: 'cycle', items: ['a', 'off'] }, days: [{ key: 'a', name: 'Treino A', exercises: [] }] },
    activated_at: status === 'draft' ? null : '2026-10-10T12:00:00.123456+00:00',
    low_confidence: ['days[0].name'],
  },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
  ...overrides,
})

describe('planRepo', () => {
  it('a pulled plan_version is stored and getActive returns the active one', async () => {
    const db = await newLocalDb()

    await planVersionSync.applyRemote(db, planRecord(OLD_ID, 'archived', 1))
    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'active', 2))

    const active = await planRepo.getActive(db, 'workout')
    expect(active).toMatchObject({
      id: PLAN_ID,
      kind: 'workout',
      status: 'active',
      activatedAt: '2026-10-10T12:00:00.123Z',
      lowConfidence: ['days[0].name'],
    })
    expect((active!.document as { days: { key: string }[] }).days[0]!.key).toBe('a')
    expect(await planRepo.getActive(db, 'protocol')).toBeNull()
    expect((await planRepo.list(db, 'workout')).map((p) => p.id)).toEqual([PLAN_ID, OLD_ID])
  })

  it('an older version of a record does not overwrite a newer one, a newer one replaces it', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'active', 5))

    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'draft', 4))
    expect((await planRepo.byId(db, PLAN_ID))?.status).toBe('active')

    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'archived', 6))
    expect(await planRepo.getActive(db, 'workout')).toBeNull()
    expect((await planRepo.byId(db, PLAN_ID))?.status).toBe('archived')
  })

  it('a deleted record disappears', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'draft', 1))

    await planVersionSync.applyRemote(db, planRecord(PLAN_ID, 'draft', 2, { payload: null, deletedAt: '2026-10-11T00:00:00+00:00' }))

    expect(await planRepo.list(db, 'workout')).toEqual([])
  })

  it('stores exercises with the muscle group converted from snake_case', async () => {
    const db = await newLocalDb()

    await exerciseSync.applyRemote(db, {
      entity: 'exercise',
      id: EX_ID,
      version: 1,
      payload: { name: 'Stiff', normalized_name: 'stiff', primary_muscle_group: 'lower_back', aliases: ['good morning'], catalog_id: 'cat-stiff' },
      deletedAt: null,
      clientUpdatedAt: '2026-10-10T12:00:00+00:00',
    })

    expect(await exerciseRepo.byId(db, EX_ID)).toEqual({
      id: EX_ID,
      name: 'Stiff',
      normalizedName: 'stiff',
      primaryMuscleGroup: 'lowerBack',
      aliases: ['good morning'],
      catalogId: 'cat-stiff',
    })
    expect(await exerciseRepo.all(db)).toHaveLength(1)
  })

  it('an exercise pulled without catalog_id (an older server) has no catalog link, and a later pull clears it', async () => {
    const db = await newLocalDb()
    const record = (payload: Record<string, unknown>, version: number) => ({
      entity: 'exercise',
      id: EX_ID,
      version,
      payload: { name: 'Stiff', normalized_name: 'stiff', primary_muscle_group: 'hamstrings', aliases: [], ...payload },
      deletedAt: null,
      clientUpdatedAt: '2026-10-10T12:00:00+00:00',
    })

    await exerciseSync.applyRemote(db, record({}, 1))
    expect((await exerciseRepo.byId(db, EX_ID))?.catalogId).toBeNull()

    await exerciseSync.applyRemote(db, record({ catalog_id: 'cat-1' }, 2))
    expect((await exerciseRepo.byId(db, EX_ID))?.catalogId).toBe('cat-1')

    await exerciseSync.applyRemote(db, record({ catalog_id: null }, 3))
    expect((await exerciseRepo.byId(db, EX_ID))?.catalogId).toBeNull()
  })

  it('records of the new entities kept as unknown by an older app are applied by the engine', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/sync/pull': () => json({ records: [planRecord(PLAN_ID, 'active', 3)], nextSince: 3, hasMore: false }) })
    await new SyncEngine(db, newTestApi(), () => new Date('2026-10-18T12:00:00Z'), []).runOnce()
    expect(await planRepo.getActive(db, 'workout')).toBeNull()
    expect(await db.query('SELECT id FROM sync_unknown')).toHaveLength(1)

    mockFetch({ 'GET /api/sync/pull': () => json({ records: [], nextSince: 3, hasMore: false }) })
    await new SyncEngine(db, newTestApi(), () => new Date('2026-10-18T12:01:00Z')).runOnce()

    expect((await planRepo.getActive(db, 'workout'))?.id).toBe(PLAN_ID)
    expect(await db.query('SELECT id FROM sync_unknown')).toEqual([])
  })
})
