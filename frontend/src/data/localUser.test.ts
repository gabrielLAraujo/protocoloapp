import { describe, expect, it } from 'vitest'
import { json, mockFetch, problem } from '../test/fetch-mock'
import { newLocalDb, newTestApi, USER_A, USER_B } from '../test/localDb'
import { dailyCheckinRepo } from './dailyCheckinRepo'
import { bindLocalUser, resolveLocalUser } from './localUser'
import { outbox } from './outbox'
import { syncState } from './syncState'

const fields = {
  sleepQuality: 4,
  bowel: 'normal' as const,
  energyWake: 3,
  energyDay: 4,
  anxiety: 2,
  waterL: 2.5,
  weightKg: null,
  note: null,
  cardioDone: null,
  cardioMinutes: null,
}
const T0 = new Date('2026-10-18T12:00:00.000Z')

describe('local user', () => {
  it('stores the user id on first login', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/auth/me': () => json({ id: USER_A, email: 'teste@example.com' }) })

    expect(await resolveLocalUser(db, newTestApi())).toBe(USER_A)
    expect(await syncState.get(db, 'user_id')).toBe(USER_A)
  })

  it('keeps the local data of the same user', async () => {
    const db = await newLocalDb()
    await bindLocalUser(db, USER_A)
    await dailyCheckinRepo.upsert(db, USER_A, '2026-10-18', fields, T0)
    await syncState.set(db, 'last_since', '42')

    await bindLocalUser(db, USER_A)

    expect(await dailyCheckinRepo.get(db, '2026-10-18')).not.toBeNull()
    expect(await outbox.pendingCount(db)).toBe(1)
    expect(await syncState.get(db, 'last_since')).toBe('42')
  })

  it('wipes the local data when another user signs in on the device', async () => {
    const db = await newLocalDb()
    await bindLocalUser(db, USER_A)
    await dailyCheckinRepo.upsert(db, USER_A, '2026-10-18', fields, T0)
    await syncState.set(db, 'last_since', '42')

    await bindLocalUser(db, USER_B)

    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()
    expect(await outbox.pendingCount(db)).toBe(0)
    expect(await syncState.get(db, 'last_since')).toBeNull()
    expect(await syncState.get(db, 'user_id')).toBe(USER_B)
  })

  it('offline, falls back to the stored user id', async () => {
    const db = await newLocalDb()
    await bindLocalUser(db, USER_A)
    mockFetch({
      'GET /api/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })

    expect(await resolveLocalUser(db, newTestApi())).toBe(USER_A)
  })

  it('without network and without a stored user, there is no user yet', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/auth/me': () => problem(503) })

    expect(await resolveLocalUser(db, newTestApi())).toBeNull()
  })
})
