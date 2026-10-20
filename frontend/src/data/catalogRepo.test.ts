import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi } from '../test/localDb'
import { catalogRepo } from './catalogRepo'

// Fictitious catalog items.
const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  bodyParts: ['upper arms'],
  targetMuscles: ['biceps'],
  equipments: ['cable'],
  gifUrl: `https://static.exercisedb.dev/media/${id}.gif`,
  ...extra,
})

const catalog = (version: string, ...items: ReturnType<typeof item>[]) => json({ version, items })

afterEach(() => vi.restoreAllMocks())

describe('catalogRepo.refresh', () => {
  it('stores the items and the version of a 200, and sends no If-None-Match on the first call', async () => {
    const db = await newLocalDb()
    const calls = mockFetch({ 'GET /api/exercise-catalog': () => catalog('100-2', item('a1', 'Alpha curl'), item('b2', 'Beta press', { gifUrl: null })) })

    expect(await catalogRepo.refresh(db, newTestApi())).toBe('updated')

    expect(calls[0]!.headers.get('If-None-Match')).toBeNull()
    expect(await catalogRepo.count(db)).toBe(2)
    expect(await catalogRepo.get(db, 'a1')).toEqual(item('a1', 'Alpha curl'))
    expect((await catalogRepo.get(db, 'b2'))?.gifUrl).toBeNull()
    expect(await catalogRepo.get(db, 'zzz')).toBeNull()
  })

  it('a 304 keeps the stored items; the second call sends the stored version as the ETag', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/exercise-catalog': () => catalog('100-1', item('a1', 'Alpha curl')) })
    await catalogRepo.refresh(db, newTestApi())

    const calls = mockFetch({ 'GET /api/exercise-catalog': () => new Response(null, { status: 304, headers: { ETag: '"100-1"' } }) })
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('unchanged')

    expect(calls[0]!.headers.get('If-None-Match')).toBe('"100-1"')
    expect(await catalogRepo.count(db)).toBe(1)
  })

  it('a changed catalog replaces everything in one go (removed items disappear)', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/exercise-catalog': () => catalog('100-2', item('a1', 'Alpha curl'), item('b2', 'Beta press')) })
    await catalogRepo.refresh(db, newTestApi())

    mockFetch({ 'GET /api/exercise-catalog': () => catalog('200-2', item('b2', 'Beta press renamed'), item('c3', 'Gamma row')) })
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('updated')

    expect(await catalogRepo.get(db, 'a1')).toBeNull()
    expect((await catalogRepo.get(db, 'b2'))?.name).toBe('Beta press renamed')
    expect(await catalogRepo.count(db)).toBe(2)
  })

  it('an empty catalog (server sync not done) is stored and works, and does not wipe a good copy', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/exercise-catalog': () => catalog('0-0') })
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('updated')
    expect(await catalogRepo.count(db)).toBe(0)
    expect(await catalogRepo.search(db, 'alpha')).toEqual([])
    expect(await catalogRepo.get(db, 'a1')).toBeNull()

    mockFetch({ 'GET /api/exercise-catalog': () => catalog('100-1', item('a1', 'Alpha curl')) })
    await catalogRepo.refresh(db, newTestApi())
    mockFetch({ 'GET /api/exercise-catalog': () => catalog('0-0') })
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('unchanged')
    expect(await catalogRepo.count(db)).toBe(1)
  })

  it('a failure (offline, server error) keeps the catalog and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = await newLocalDb()
    mockFetch({ 'GET /api/exercise-catalog': () => catalog('100-1', item('a1', 'Alpha curl')) })
    await catalogRepo.refresh(db, newTestApi())

    mockFetch({ 'GET /api/exercise-catalog': () => new Response('x', { status: 503 }) })
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('failed')
    mockFetch({})
    expect(await catalogRepo.refresh(db, newTestApi())).toBe('failed')

    expect(await catalogRepo.count(db)).toBe(1)
  })
})

describe('catalogRepo.search', () => {
  it('finds names containing every word, case-insensitive, shortest first, up to the limit', async () => {
    const db = await newLocalDb()
    mockFetch({
      'GET /api/exercise-catalog': () =>
        catalog('1-4', item('a', 'cable alpha curl'), item('b', 'Alpha curl'), item('c', 'beta curl'), item('d', '100%_wild')),
    })
    await catalogRepo.refresh(db, newTestApi())

    expect((await catalogRepo.search(db, 'ALPHA curl')).map((i) => i.id)).toEqual(['b', 'a'])
    expect((await catalogRepo.search(db, 'curl', 2)).map((i) => i.id)).toEqual(['c', 'b'])
    expect(await catalogRepo.search(db, '   ')).toEqual([])
    // LIKE wildcards in the text are literal.
    expect((await catalogRepo.search(db, '%_')).map((i) => i.id)).toEqual(['d'])
    expect(await catalogRepo.search(db, '%')).toHaveLength(1)
  })
})
