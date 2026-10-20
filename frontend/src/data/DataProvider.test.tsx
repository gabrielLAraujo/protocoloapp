import { render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type Auth, type Status } from '../auth/authContext'
import { json, mockFetch, type Call } from '../test/fetch-mock'
import { USER_A, USER_B } from '../test/localDb'
import { useData, type Data } from './dataContext'
import { DataProvider } from './DataProvider'
import { checkinIdForDate } from './ids'
import { syncState } from './syncState'

vi.mock('./sqliteLocalDb', async () => {
  const { createSqlJsLocalDb } = await import('./sqlJsLocalDb')
  return { createSqliteLocalDb: () => createSqlJsLocalDb() }
})

// What the provider exposes, captured from the tree.
const seen: { data: Data | null } = { data: null }
function Probe() {
  const data = useData()
  useEffect(() => {
    seen.data = data
  })
  return <p>{data?.userId ?? 'sem usuário'}</p>
}

const auth = (status: Status): Auth => ({ status, login: async () => {}, logout: async () => {} })
const tree = (status: Status) => (
  <AuthContext value={auth(status)}>
    <DataProvider>
      <Probe />
    </DataProvider>
  </AuthContext>
)

describe('DataProvider', () => {
  it('a sync run that crosses a user switch finishes before the new user wipes and binds the database', async () => {
    let me = USER_A
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const pullsOf: Record<string, Call[]> = { [USER_A]: [], [USER_B]: [] }
    mockFetch({
      'GET /api/auth/me': () => json({ id: me, email: 'teste@example.com' }),
      'GET /api/sync/pull': async (call) => {
        const user = me
        pullsOf[user]!.push(call)
        if (user === USER_A) {
          await held
          const record = {
            entity: 'daily_checkin',
            id: checkinIdForDate(USER_A, '2026-10-18'),
            version: 3,
            payload: { date: '2026-10-18', sleep_quality: 3, bowel: 'normal', energy_wake: 3, energy_day: 3, anxiety: 3, water_l: 2, weight_kg: null, note: null },
            deletedAt: null,
            clientUpdatedAt: '2026-10-18T10:00:00Z',
          }
          return json({ records: [record], nextSince: 3, hasMore: false })
        }
        return json({ records: [], nextSince: 0, hasMore: false })
      },
    })

    const { rerender } = render(tree('signedIn'))
    await screen.findByText(USER_A)
    await waitFor(() => expect(pullsOf[USER_A]).toHaveLength(1))

    rerender(tree('signedOut'))
    me = USER_B
    rerender(tree('signedIn'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()

    await screen.findByText(USER_B)
    // The provider may still be opening user B's data (catalog refresh runs alongside), so wait for it.
    await waitFor(() => expect(seen.data?.engine).toBeTruthy())
    await seen.data!.engine.whenIdle()
    const db = seen.data!.db
    expect(await syncState.get(db, 'user_id')).toBe(USER_B)
    expect(await db.query('SELECT id FROM daily_checkins')).toEqual([])
    expect(await syncState.get(db, 'last_since')).toBe('0')
    expect(pullsOf[USER_B]!.map((c) => c.path)).toEqual(['/api/sync/pull?since=0&limit=500'])
  })
})
