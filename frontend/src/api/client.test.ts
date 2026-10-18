import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tokenStore } from '../auth/tokenStore'
import { getLocks, REFRESH_LOCK } from '../platform/locks'
import { json, mockFetch, problem, tokenResponse } from '../test/fetch-mock'
import { fakeLocks, installLocks } from '../test/fakeLocks'
import { api } from './client'

beforeEach(async () => {
  await tokenStore.clear()
  await tokenStore.setTokens(tokenResponse('old'))
})

describe('api client', () => {
  it('attaches bearer token', async () => {
    const calls = mockFetch({ 'GET /api/auth/me': () => json({ id: 'x', email: 'a@example.com' }) })

    const { response } = await api.GET('/api/auth/me')

    expect(response.ok).toBe(true)
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer access-old')
  })

  it('refreshes once on 401 and retries', async () => {
    let refreshCalls = 0
    const calls = mockFetch({
      'GET /api/auth/me': (call) =>
        call.headers.get('Authorization') === 'Bearer access-new'
          ? json({ id: 'x', email: 'a@example.com' })
          : problem(401),
      'POST /api/auth/refresh': async (call) => {
        refreshCalls++
        expect(JSON.parse(call.body)).toEqual({ refreshToken: 'refresh-old' })
        // Slow enough for the three parallel requests to all hit the 401 before the refresh finishes.
        await new Promise((resolve) => setTimeout(resolve, 20))
        return json(tokenResponse('new'))
      },
    })

    const results = await Promise.all([api.GET('/api/auth/me'), api.GET('/api/auth/me'), api.GET('/api/auth/me')])

    expect(results.map((result) => result.response.status)).toEqual([200, 200, 200])
    expect(refreshCalls).toBe(1)
    expect(calls.filter((call) => call.path === '/api/auth/me')).toHaveLength(6)
    expect(tokenStore.getAccessToken()).toBe('access-new')
    expect(await tokenStore.getRefreshToken()).toBe('refresh-new')
  })

  it('logs out when refresh fails', async () => {
    mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': () => problem(401),
    })
    const clear = vi.spyOn(tokenStore, 'clear')
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    const { response } = await api.GET('/api/auth/me')
    window.removeEventListener('auth:logout', onLogout)

    expect(response.status).toBe(401)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(await tokenStore.getRefreshToken()).toBeNull()
  })

  it('does not refresh on a 401 from an auth endpoint', async () => {
    const calls = mockFetch({
      'POST /api/auth/login': () => problem(401),
    })

    const { response } = await api.POST('/api/auth/login', { body: { email: 'a@example.com', password: 'wrong' } })

    expect(response.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('keeps the session when the refresh fails for lack of network', async () => {
    mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const clear = vi.spyOn(tokenStore, 'clear')

    const { response } = await api.GET('/api/auth/me')

    expect(response.status).toBe(401)
    expect(clear).not.toHaveBeenCalled()
  })

  it.each([503, 429])('keeps the session when the refresh answers %i', async (status) => {
    mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': () => problem(status),
    })
    const clear = vi.spyOn(tokenStore, 'clear')
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    const { response } = await api.GET('/api/auth/me')
    window.removeEventListener('auth:logout', onLogout)

    expect(response.status).toBe(401)
    expect(clear).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    expect(await tokenStore.getRefreshToken()).toBe('refresh-old')
  })

  it('keeps the session when the refresh answers 200 with a malformed body', async () => {
    mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': () => new Response('not json', { status: 200 }),
    })
    const clear = vi.spyOn(tokenStore, 'clear')
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    const { response } = await api.GET('/api/auth/me')
    window.removeEventListener('auth:logout', onLogout)

    expect(response.status).toBe(401)
    expect(clear).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    expect(await tokenStore.getRefreshToken()).toBe('refresh-old')
  })

  it('discards a refresh that finishes after the user signed out', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const calls = mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': async () => {
        await gate
        return json(tokenResponse('late'))
      },
    })

    const pending = api.GET('/api/auth/me')
    await vi.waitFor(() => expect(calls.map((call) => call.path)).toContain('/api/auth/refresh'))
    await tokenStore.clear() // the user signs out while the refresh is in flight
    release()
    const { response } = await pending

    expect(response.status).toBe(401)
    expect(tokenStore.getAccessToken()).toBeNull()
    expect(await tokenStore.getRefreshToken()).toBeNull()
  })

  describe('refresh across tabs', () => {
    const meAndRefresh = () => {
      const refreshed: string[] = []
      mockFetch({
        'GET /api/auth/me': (call) =>
          call.headers.get('Authorization') === 'Bearer access-new' ? json({ id: 'x', email: 'a@example.com' }) : problem(401),
        'POST /api/auth/refresh': (call) => {
          refreshed.push((JSON.parse(call.body) as { refreshToken: string }).refreshToken)
          return json(tokenResponse('new'))
        },
      })
      return refreshed
    }

    it('waits for the refresh lock and presents the token stored meanwhile', async () => {
      const locks = fakeLocks()
      const uninstall = installLocks(locks)
      try {
        const refreshed = meAndRefresh()
        const release = await locks.hold(REFRESH_LOCK) // another tab is refreshing

        const pending = api.GET('/api/auth/me')
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(refreshed).toEqual([])

        // That tab stored its rotated refresh token, then let go of the lock.
        localStorage.setItem('protocolo.refreshToken', 'refresh-other')
        release()

        expect((await pending).response.status).toBe(200)
        expect(refreshed).toEqual(['refresh-other'])
        expect(locks.held.has(REFRESH_LOCK)).toBe(false)
      } finally {
        uninstall()
      }
    })

    it('refreshes without a lock when the browser has no Web Locks', async () => {
      const uninstall = installLocks(undefined)
      try {
        expect(getLocks()).toBeUndefined()
        const refreshed = meAndRefresh()

        expect((await api.GET('/api/auth/me')).response.status).toBe(200)
        expect(refreshed).toEqual(['refresh-old'])
      } finally {
        uninstall()
      }
    })
  })
})
