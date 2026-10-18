import { Capacitor } from '@capacitor/core'
import createClient, { type Middleware } from 'openapi-fetch'
import { tokenStore, type TokenResponse } from '../auth/tokenStore'
import type { paths } from './schema'

export const LOGOUT_EVENT = 'auth:logout'

// Same origin by default (the API serves the front; in dev Vite proxies). Explicit instead of '' because Node's Request,
// used by the tests, rejects relative URLs. The APK sets VITE_API_URL at build time.
const configuredUrl: string | undefined = import.meta.env.VITE_API_URL

// In the APK the origin is the app's own https://localhost, not the API: without VITE_API_URL every call would silently
// hit the wrong server.
if (Capacitor.isNativePlatform() && !configuredUrl) {
  throw new Error('VITE_API_URL must be set in native builds.')
}

const baseUrl: string = configuredUrl ?? window.location.origin

export const api = createClient<paths>({
  baseUrl,
  // Reads the global fetch on every call (not at creation): the tests swap in a fake.
  fetch: (request) => globalThis.fetch(request),
})

// A 401 from these is an answer, not an expired session: never refresh on it.
const NO_REFRESH_PATHS = new Set(['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'])

/**
 * Single-flight refresh. The server revokes the whole token family when a refresh token is reused, so two concurrent
 * refreshes would log the user out: every caller shares the one in flight.
 * Resolves true when new tokens are in place, false otherwise.
 */
let refreshing: Promise<boolean> | null = null

export function refreshTokens(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function doRefresh(): Promise<boolean> {
  const epoch = tokenStore.getEpoch()
  const refreshToken = await tokenStore.getRefreshToken()
  if (!refreshToken) return fail(epoch)

  let response: Response
  try {
    // Plain fetch, not `api`: the refresh must not go through the middleware (no Bearer, no retry).
    response = await globalThis.fetch(
      new Request(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }),
    )
  } catch {
    // No network: the session may still be good, so keep the tokens and let the caller see the 401.
    return false
  }

  // Only a definitive rejection ends the session. 5xx, 429 and the like are transient: keep the tokens.
  if (response.status === 400 || response.status === 401) return fail(epoch)
  if (!response.ok) return false

  let tokens: TokenResponse
  try {
    tokens = (await response.json()) as TokenResponse
  } catch {
    return false
  }
  if (!tokens.accessToken || !tokens.refreshToken) return false

  // False when the user signed out while this was in flight: the result is discarded.
  return tokenStore.setTokens(tokens, epoch)
}

async function fail(epoch: number): Promise<false> {
  // Already signed out meanwhile: nothing left to clear or announce.
  if (epoch !== tokenStore.getEpoch()) return false
  await tokenStore.clear()
  window.dispatchEvent(new Event(LOGOUT_EVENT))
  return false
}

// Per request: a clone to replay (the body is consumed by the first send) and the token it was sent with.
const sent = new Map<string, { replay: Request; token: string | null }>()

const middleware: Middleware = {
  onRequest({ request, id }) {
    const token = tokenStore.getAccessToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    sent.set(id, { replay: request.clone(), token })
  },

  async onResponse({ response, id, schemaPath }) {
    const attempt = sent.get(id)
    sent.delete(id)
    if (response.status !== 401 || !attempt || NO_REFRESH_PATHS.has(schemaPath)) return

    // Another request may have refreshed already while this one was in flight: then just retry with the new token.
    const alreadyRefreshed = tokenStore.getAccessToken() !== null && tokenStore.getAccessToken() !== attempt.token
    if (!alreadyRefreshed && !(await refreshTokens())) return

    const token = tokenStore.getAccessToken()
    if (!token) return
    attempt.replay.headers.set('Authorization', `Bearer ${token}`)
    // Not through `api` again: one retry only, no loop.
    return globalThis.fetch(attempt.replay).catch(() => response)
  },

  onError({ id }) {
    sent.delete(id)
  },
}

api.use(middleware)
