import type { SyncRecord } from './apiClient'
import type { LocalDb } from './localDb'
import { outbox, type OutboxEntry } from './outbox'

/**
 * What the sync engine needs from an entity. A new entity adds its table (migration), a repository that writes the row
 * and enqueues the change in one transaction, and one of these in `syncEntities` (registry.ts).
 */
export interface SyncEntityAdapter {
  /** The server's entity name (`SyncChange.entity`). */
  readonly entity: string
  /** Local table, wiped when another user signs in on the device. */
  readonly table: string
  /** Applies a pulled record (called inside the pull transaction). Must not overwrite a newer local pending change. */
  applyRemote(db: LocalDb, record: SyncRecord): Promise<void>
  /**
   * Optional: called (inside the push transaction, before the entry is acked) when the server answered `stale` for a
   * change of this entity. Entities that merge pulled records with pending changes use it to fetch the server's state again.
   */
  onStale?(db: LocalDb, entry: OutboxEntry): Promise<void>
}

/**
 * Last-writer-wins on the device: a pulled record is skipped when the local row has a pending change at least as new.
 * The pending change then reaches the server, which keeps it; a newer remote wins and the pending one comes back stale.
 */
export async function localChangeWins(
  db: LocalDb,
  entity: string,
  id: string,
  localClientUpdatedAt: string | undefined,
  remoteClientUpdatedAt: string,
): Promise<boolean> {
  if (localClientUpdatedAt === undefined) return false
  if (!(await outbox.hasPending(db, entity, id))) return false
  return Date.parse(localClientUpdatedAt) >= Date.parse(remoteClientUpdatedAt)
}

/**
 * The clientUpdatedAt of a new local change: the device clock, but always after the previous change of the same row.
 * A clock set backwards would otherwise make the user's latest edit lose (stale) to their previous one.
 */
export function nextClientUpdatedAt(now: Date, previous: string | undefined): string {
  const floor = previous === undefined ? -Infinity : Date.parse(previous) + 1
  return new Date(Math.max(now.getTime(), floor)).toISOString()
}

/** Remote timestamps carry microseconds and an offset; locally everything is `toISOString()` (ms, UTC). */
export const normalizeTimestamp = (value: string) => new Date(value).toISOString()

/**
 * The common part of applying a pulled record to a row of `table` (a constant, never user input): skips records the
 * device already has (or a pending local change that is newer), turns a delete into `deleted_at`, and otherwise
 * calls `write` with the payload and the normalized client_updated_at.
 */
export async function applyPulled(
  db: LocalDb,
  entity: string,
  table: string,
  record: SyncRecord,
  write: (payload: unknown, clientUpdatedAt: string) => Promise<void>,
): Promise<void> {
  const [local] = await db.query<{ version: number | null; client_updated_at: string }>(
    `SELECT version, client_updated_at FROM ${table} WHERE id = ?`,
    [record.id],
  )
  if (local?.version != null && record.version <= local.version) return
  if (await localChangeWins(db, entity, record.id, local?.client_updated_at, record.clientUpdatedAt)) return

  const clientUpdatedAt = normalizeTimestamp(record.clientUpdatedAt)
  if (record.deletedAt !== null || record.payload === null) {
    // Nothing to hide when the row never reached this device.
    if (local)
      await db.execute(`UPDATE ${table} SET deleted_at = ?, client_updated_at = ?, version = ? WHERE id = ?`, [
        normalizeTimestamp(record.deletedAt ?? record.clientUpdatedAt),
        clientUpdatedAt,
        record.version,
        record.id,
      ])
    return
  }
  await write(record.payload, clientUpdatedAt)
}
