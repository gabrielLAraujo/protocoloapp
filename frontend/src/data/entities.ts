import type { SyncRecord } from './apiClient'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

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
