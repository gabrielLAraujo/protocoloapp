import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createPhotoQueue } from './photoQueue'

const CYCLE = '5b0f7c1e-1d2a-4b3c-8d4e-000000000001'
const OTHER_CYCLE = '5b0f7c1e-1d2a-4b3c-8d4e-000000000002'

// A generated "photo": a few bytes of a fake JPEG, never a real image.
const generated = (seed: number) => new Blob([new Uint8Array([0xff, 0xd8, seed, seed, 0xff, 0xd9])], { type: 'image/jpeg' })

const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())]

describe('photoQueue', () => {
  it('survives a new connection to the database (an app reload) with the bytes intact', async () => {
    const factory = new IDBFactory()
    const first = createPhotoQueue(() => factory)
    await first.add({ id: 'p1', cycleId: CYCLE, pose: 'front', blob: generated(1), takenAt: '2026-10-19T09:00:00.000Z' })
    first.close()

    const reloaded = createPhotoQueue(() => factory)
    const [item, ...rest] = await reloaded.list()

    expect(rest).toEqual([])
    expect(item).toMatchObject({ id: 'p1', cycleId: CYCLE, pose: 'front', takenAt: '2026-10-19T09:00:00.000Z' })
    expect(item!.blob.type).toBe('image/jpeg')
    expect(await bytesOf(item!.blob)).toEqual([0xff, 0xd8, 1, 1, 0xff, 0xd9])
  })

  it('lists by takenAt and removes by id', async () => {
    const queue = createPhotoQueue(() => new IDBFactory())
    await queue.add({ id: 'b', cycleId: CYCLE, pose: 'back', blob: generated(2), takenAt: '2026-10-19T09:05:00.000Z' })
    await queue.add({ id: 'a', cycleId: CYCLE, pose: 'front', blob: generated(1), takenAt: '2026-10-19T09:00:00.000Z' })

    expect((await queue.list()).map((p) => p.id)).toEqual(['a', 'b'])
    await queue.remove('a')
    expect((await queue.list()).map((p) => p.id)).toEqual(['b'])
  })

  it('a new photo of a pose replaces the one still waiting for the same cycle and pose', async () => {
    const queue = createPhotoQueue(() => new IDBFactory())
    await queue.add({ id: 'old', cycleId: CYCLE, pose: 'front', blob: generated(1), takenAt: '2026-10-19T09:00:00.000Z' })
    await queue.add({ id: 'other', cycleId: OTHER_CYCLE, pose: 'front', blob: generated(3), takenAt: '2026-10-19T09:01:00.000Z' })
    await queue.add({ id: 'new', cycleId: CYCLE, pose: 'front', blob: generated(2), takenAt: '2026-10-19T09:02:00.000Z' })

    expect((await queue.list()).map((p) => p.id)).toEqual(['other', 'new'])
  })
})
