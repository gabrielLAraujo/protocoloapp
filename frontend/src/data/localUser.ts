import type { ApiClient } from './apiClient'
import type { LocalDb } from './localDb'
import { PHOTO_THUMBS_TABLE } from './photoThumbRepo'
import { syncEntities } from './registry'
import { syncState } from './syncState'

/** Local-only tables that hold the user's data and go with it (not synced, so not in `syncEntities`). */
const LOCAL_USER_TABLES = [PHOTO_THUMBS_TABLE]

/**
 * Makes `userId` the owner of the local database. When it holds another user's data (another account signed in on this
 * device), everything local is wiped first, unsent changes included: they could never sync under this account anyway.
 */
export async function bindLocalUser(db: LocalDb, userId: string, tables: readonly string[] = syncEntities.map((e) => e.table)): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await syncState.get(tx, 'user_id')
    if (current === userId) return
    if (current !== null) {
      for (const table of [...tables, ...LOCAL_USER_TABLES, 'outbox', 'sync_unknown', 'sync_state']) await tx.execute(`DELETE FROM ${table}`)
      // The cached update metrics (features/update/metricsCache.ts) carry the user's check-in notes and deviations.
      await tx.execute("DELETE FROM kv WHERE key LIKE 'update_metrics:%'")
    }
    await syncState.set(tx, 'user_id', userId)
  })
}

/**
 * The signed-in user's id: from GET /api/auth/me when online (binding the local data to it), else the one stored
 * locally, so the app works offline. Null when neither is available (first start without network).
 */
export async function resolveLocalUser(db: LocalDb, api: ApiClient): Promise<string | null> {
  try {
    const { data, response } = await api.GET('/api/auth/me')
    const id = response.ok ? (data as { id?: unknown } | undefined)?.id : undefined
    if (typeof id === 'string' && id) {
      await bindLocalUser(db, id)
      return id
    }
  } catch {
    // Offline: fall back to the stored id.
  }
  return syncState.get(db, 'user_id')
}
