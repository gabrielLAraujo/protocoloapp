import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, LOGOUT_EVENT } from '../api/client'
import { toProblem } from '../api/problem'
import { forgetQueuedPhotos } from '../data/localUser'
import { AuthContext, LoginError, type Status } from './authContext'
import { tokenStore, type TokenResponse } from './tokenStore'


export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')

  // Restore: a stored refresh token means signed in. /me only warms the session (a 401 there makes the client refresh);
  // its outcome does not decide: offline-first, so a 5xx or no network keeps the user in. Only the definitive refresh
  // rejection (the auth:logout event) or the absence of a stored token signs out.
  useEffect(() => {
    let cancelled = false
    const settle = (next: Status) => {
      // Never overrides a logout event that arrived while /me was in flight.
      if (!cancelled) setStatus((current) => (current === 'loading' ? next : current))
    }
    void (async () => {
      const stored = await tokenStore.getRefreshToken()
      if (!stored) return settle('signedOut')
      await api.GET('/api/auth/me').catch(() => undefined)
      settle('signedIn')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onLogout = () => setStatus('signedOut')
    window.addEventListener(LOGOUT_EVENT, onLogout)
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    let result
    try {
      result = await api.POST('/api/auth/login', { body: { email, password } })
    } catch (error) {
      throw new LoginError({ ...toProblem(error), status: 0 })
    }
    if (!result.response.ok) throw new LoginError(toProblem({ ...(result.error as Record<string, unknown> | undefined), status: result.response.status }))

    await tokenStore.setTokens(result.data as unknown as TokenResponse)
    setStatus('signedIn')
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = await tokenStore.getRefreshToken()
    // Best effort: signing out locally must work offline.
    if (refreshToken) await api.POST('/api/auth/logout', { body: { refreshToken } }).catch(() => undefined)
    await tokenStore.clear()
    // Photos taken but not sent stay on the device only while their user is signed in.
    await forgetQueuedPhotos()
    setStatus('signedOut')
  }, [])

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}
