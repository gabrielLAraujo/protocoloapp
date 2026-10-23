import type { ApiClient } from '../../data/apiClient'

/** Users whose ensure the server answered (200 with the cycle, or 204: no active protocol with an update date) this session. */
const answered = new Set<string>()
const inFlight = new Map<string, Promise<boolean>>()

/**
 * Asks the server, once per user and app session, to create the cycle of the active protocol
 * (`POST /api/update-cycles/ensure`): a protocol activated before the cycles existed has none. Per user, so another
 * account signing in on the device asks again; a failure (no network, a server error) is not remembered and the next
 * call retries, and a 204 is asked again in the next session. Resolves true when the server returned a cycle (the caller
 * syncs to bring it).
 */
export function ensureUpdateCycle(api: ApiClient, userId: string): Promise<boolean> {
  if (answered.has(userId)) return Promise.resolve(false)
  const running = inFlight.get(userId)
  if (running) return running
  const call = (async () => {
    try {
      const { data, response } = await api.POST('/api/update-cycles/ensure')
      if (!response.ok) return false
      answered.add(userId)
      return Boolean(data)
    } catch {
      return false
    } finally {
      inFlight.delete(userId)
    }
  })()
  inFlight.set(userId, call)
  return call
}

/** For the tests. */
export function resetEnsureForTests(): void {
  answered.clear()
  inFlight.clear()
}
