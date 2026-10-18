import { secureStorage } from '../platform/secureStorage'

const REFRESH_TOKEN_KEY = 'protocolo.refreshToken'

export type TokenResponse = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
}

// The access token lives in memory only (15 min); the refresh token survives restarts in the secure store.
let accessToken: string | null = null

export const tokenStore = {
  getAccessToken: (): string | null => accessToken,

  getRefreshToken: (): Promise<string | null> => secureStorage.get(REFRESH_TOKEN_KEY),

  async setTokens(tokens: Pick<TokenResponse, 'accessToken' | 'refreshToken'>): Promise<void> {
    accessToken = tokens.accessToken
    await secureStorage.set(REFRESH_TOKEN_KEY, tokens.refreshToken)
  },

  async clear(): Promise<void> {
    accessToken = null
    await secureStorage.remove(REFRESH_TOKEN_KEY)
  },
}
