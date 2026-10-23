import type { ApiClient } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { updateMetricsSchema, type UpdateMetrics } from './updateMetrics'

/** The kv keys of the cached metrics (wiped with the user's data when another account signs in). */
export const METRICS_KEY_PREFIX = 'update_metrics:'
const keyOf = (cycleId: string) => `${METRICS_KEY_PREFIX}${cycleId}`

export interface CachedMetrics {
  metrics: UpdateMetrics
  /** ISO timestamp of the response. */
  fetchedAt: string
}

/** The last metrics the server answered for each cycle, kept in `kv` so the questionnaire fills offline. */
export const metricsCache = {
  async get(db: LocalDb, cycleId: string): Promise<CachedMetrics | null> {
    const [row] = await db.query<{ value: string }>('SELECT value FROM kv WHERE key = ?', [keyOf(cycleId)])
    if (!row) return null
    try {
      const stored = JSON.parse(row.value) as { metrics?: unknown; fetchedAt?: unknown }
      const metrics = updateMetricsSchema.safeParse(stored.metrics)
      if (!metrics.success || typeof stored.fetchedAt !== 'string') return null
      return { metrics: metrics.data, fetchedAt: stored.fetchedAt }
    } catch {
      return null
    }
  },

  async put(db: LocalDb, cycleId: string, metrics: UpdateMetrics, now: Date): Promise<void> {
    const value = JSON.stringify({ metrics, fetchedAt: now.toISOString() })
    await db.execute('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [keyOf(cycleId), value])
  },
}

export interface LoadedMetrics extends CachedMetrics {
  /** True when the server could not be reached and these are the last ones stored. */
  cached: boolean
}

/**
 * The cycle's metrics: from the server when online (stored for later), otherwise (offline, an error, an answer this
 * version cannot read) the cached ones; null when there are none. Never rejects for a network failure.
 */
export async function loadMetrics(db: LocalDb, api: ApiClient, cycleId: string, now: Date): Promise<LoadedMetrics | null> {
  const fromCache = async () => {
    const hit = await metricsCache.get(db, cycleId)
    return hit ? { ...hit, cached: true } : null
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fromCache()
  try {
    const { data } = await api.GET('/api/update-cycles/{id}/metrics', { params: { path: { id: cycleId } } })
    const parsed = updateMetricsSchema.safeParse(data)
    if (!parsed.success) return fromCache()
    await metricsCache.put(db, cycleId, parsed.data, now)
    return { metrics: parsed.data, fetchedAt: now.toISOString(), cached: false }
  } catch {
    return fromCache()
  }
}
