import { secureStorage } from '../platform/secureStorage'

const REFRESH_TOKEN_KEY = 'protocolo.refreshToken'

export type TokenResponse = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
}

// The access token lives in memory only (15 min); the refresh token survives restarts in the secure store.
let accessToken: string | null = null

// Bumped by every clear(). A refresh that started before a logout compares it before storing its result, so it cannot
// write tokens back after the user signed out.
let epoch = 0

export const tokenStore = {
  getAccessToken: (): string | null => accessToken,

  getRefreshToken: (): Promise<string | null> => secureStorage.get(REFRESH_TOKEN_KEY),

  getEpoch: (): number => epoch,

  /** With `expectedEpoch`, the tokens are discarded (returns false) when a clear() happened since that epoch was read. */
  async setTokens(tokens: Pick<TokenResponse, 'accessToken' | 'refreshToken'>, expectedEpoch?: number): Promise<boolean> {
    if (expectedEpoch !== undefined && expectedEpoch !== epoch) return false
    accessToken = tokens.accessToken
    await secureStorage.set(REFRESH_TOKEN_KEY, tokens.refreshToken)
    return true
  },

  async clear(): Promise<void> {
    epoch++
    accessToken = null
    await secureStorage.remove(REFRESH_TOKEN_KEY)
  },
}
