import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tokenStore } from '../auth/tokenStore'
import { json, mockFetch, problem, tokenResponse } from '../test/fetch-mock'
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
})
