import type { LocalDb } from './localDb'

export type SyncStateKey = 'last_since' | 'last_sync_at' | 'user_id'

export const syncState = {
  async get(db: LocalDb, key: SyncStateKey): Promise<string | null> {
    const [row] = await db.query<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key])
    return row?.value ?? null
  },

  async set(db: LocalDb, key: SyncStateKey, value: string): Promise<void> {
    await db.execute(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  },
}
