import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, LOGOUT_EVENT } from '../api/client'
import { toProblem } from '../api/problem'
import { AuthContext, LoginError, type Status } from './authContext'
import { tokenStore, type TokenResponse } from './tokenStore'


export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')

  // Restore: a stored refresh token means "probably signed in". /me settles it; a 401 there makes the client refresh.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await tokenStore.getRefreshToken()
      if (!stored) return !cancelled && setStatus('signedOut')
      try {
        const { response } = await api.GET('/api/auth/me')
        if (!cancelled) setStatus(response.ok ? 'signedIn' : 'signedOut')
      } catch {
        // Offline at startup: the app is offline-first, so trust the stored session.
        if (!cancelled) setStatus('signedIn')
      }
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
    setStatus('signedOut')
  }, [])

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}
