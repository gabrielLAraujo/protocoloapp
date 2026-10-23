import { describe, expect, it } from 'vitest'
import { newLocalDb, USER_A, USER_B } from '../test/localDb'
import { bindLocalUser } from './localUser'
import { outbox } from './outbox'
import { photoThumbRepo } from './photoThumbRepo'

// A fictitious 1-pixel placeholder, not a photo.
const DATA_URL = 'data:image/jpeg;base64,AAAA'

describe('photoThumbRepo', () => {
  it('keeps one thumbnail per pose of a cycle, outside the sync', async () => {
    const db = await newLocalDb()
    await photoThumbRepo.put(db, { fileId: 'f1', cycleId: 'c1', pose: 'front', dataUrl: DATA_URL })
    await photoThumbRepo.put(db, { fileId: 'f2', cycleId: 'c1', pose: 'back', dataUrl: DATA_URL })
    await photoThumbRepo.put(db, { fileId: 'f3', cycleId: 'c1', pose: 'front', dataUrl: `${DATA_URL}B` })
    await photoThumbRepo.put(db, { fileId: 'f4', cycleId: 'c2', pose: 'front', dataUrl: DATA_URL })

    const thumbs = await photoThumbRepo.byCycle(db, 'c1')
    expect([...thumbs.keys()].sort()).toEqual(['back', 'front'])
    expect(thumbs.get('front')).toMatchObject({ fileId: 'f3', cycleId: 'c1', pose: 'front', dataUrl: `${DATA_URL}B` })
    expect(await db.query('SELECT file_id FROM update_photo_thumbs ORDER BY file_id')).toEqual([{ file_id: 'f2' }, { file_id: 'f3' }, { file_id: 'f4' }])
    expect(await outbox.pendingCount(db)).toBe(0)
  })

  it('is wiped when another user signs in on the device', async () => {
    const db = await newLocalDb()
    await bindLocalUser(db, USER_A)
    await photoThumbRepo.put(db, { fileId: 'f1', cycleId: 'c1', pose: 'front', dataUrl: DATA_URL })

    await bindLocalUser(db, USER_A)
    expect((await photoThumbRepo.byCycle(db, 'c1')).size).toBe(1)

    await bindLocalUser(db, USER_B)
    expect((await photoThumbRepo.byCycle(db, 'c1')).size).toBe(0)
  })
})
