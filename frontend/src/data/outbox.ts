import type { LocalDb } from './localDb'

export interface OutboxEntry {
  seq: number
  entity: string
  id: string
  op: 'upsert' | 'delete'
  /** The entity payload as JSON text; null for deletes. */
  payload: string | null
  clientUpdatedAt: string
  attempts: number
  nextAttemptAt: string
  status: 'pending' | 'rejected'
  /** JSON array of the server's error codes, for rejected entries. */
  errors: string | null
}

export type NewOutboxEntry = Omit<OutboxEntry, 'seq' | 'attempts' | 'nextAttemptAt' | 'status' | 'errors'>

const BASE_DELAY_MS = 5_000
const MAX_DELAY_MS = 15 * 60_000
const DUE_NOW = new Date(0).toISOString()

/** Backoff after `attempts` failures: min(5 s × 2^attempts, 15 min). */
export const backoffMs = (attempts: number) => Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS)

type Row = {
  seq: number
  entity: string
  id: string
  op: 'upsert' | 'delete'
  payload: string | null
  client_updated_at: string
  attempts: number
  next_attempt_at: string
  status: 'pending' | 'rejected'
  errors: string | null
}

const toEntry = (row: Row): OutboxEntry => ({
  seq: row.seq,
  entity: row.entity,
  id: row.id,
  op: row.op,
  payload: row.payload,
  clientUpdatedAt: row.client_updated_at,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  status: row.status,
  errors: row.errors,
})

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

/**
 * Local changes waiting for the server. Entries are never merged: an upsert followed by a delete of the same id must
 * reach the server as both, in order (a lone delete of an unknown id leaves no tombstone, so an older upsert from
 * another device could resurrect the record). An entry leaves only on `ack` (server answered applied/stale), so a
 * crash before the answer just resends it, which the server treats as stale.
 */
export const outbox = {
  async enqueue(db: LocalDb, entry: NewOutboxEntry): Promise<void> {
    await db.execute(
      `INSERT INTO outbox (entity, id, op, payload, client_updated_at, attempts, next_attempt_at, status)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [entry.entity, entry.id, entry.op, entry.payload, entry.clientUpdatedAt, DUE_NOW],
    )
  },

  /**
   * The first `limit` pending entries in seq order, or none while the oldest one is in backoff. Order matters (see
   * above), so a failed entry holds back everything queued after it; failures are batch-wide (network, server down),
   * so this is the same wait anyway.
   */
  async due(db: LocalDb, now: Date, limit: number): Promise<OutboxEntry[]> {
    const rows = await db.query<Row>("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?", [limit])
    const head = rows[0]
    if (!head || head.next_attempt_at > now.toISOString()) return []
    return rows.map(toEntry)
  },

  async ack(db: LocalDb, seqs: number[]): Promise<void> {
    if (seqs.length === 0) return
    await db.execute(`DELETE FROM outbox WHERE seq IN (${placeholders(seqs.length)})`, seqs)
  },

  /** A failed attempt (network, server error): retried after the backoff. */
  async fail(db: LocalDb, seqs: number[], now: Date): Promise<void> {
    if (seqs.length === 0) return
    await db.transaction(async (tx) => {
      const rows = await tx.query<{ seq: number; attempts: number }>(
        `SELECT seq, attempts FROM outbox WHERE seq IN (${placeholders(seqs.length)})`,
        seqs,
      )
      for (const row of rows) {
        const attempts = row.attempts + 1
        const next = new Date(now.getTime() + backoffMs(attempts)).toISOString()
        await tx.execute('UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE seq = ?', [attempts, next, row.seq])
      }
    })
  },

  /** The server refused the change: kept for the user's attention, never retried. */
  async reject(db: LocalDb, seq: number, errors: string[]): Promise<void> {
    await db.execute("UPDATE outbox SET status = 'rejected', errors = ? WHERE seq = ?", [JSON.stringify(errors), seq])
  },

  /** Puts a rejected entry back in the queue (attempts reset), e.g. after the user fixed the cause. */
  async retry(db: LocalDb, seq: number): Promise<void> {
    await db.execute(
      "UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = ?, errors = NULL WHERE seq = ? AND status = 'rejected'",
      [DUE_NOW, seq],
    )
  },

  async rejected(db: LocalDb): Promise<OutboxEntry[]> {
    return (await db.query<Row>("SELECT * FROM outbox WHERE status = 'rejected' ORDER BY seq")).map(toEntry)
  },

  async pendingCount(db: LocalDb): Promise<number> {
    const [row] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'")
    return row?.n ?? 0
  },

  async rejectedCount(db: LocalDb): Promise<number> {
    const [row] = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status = 'rejected'")
    return row?.n ?? 0
  },

  async hasPending(db: LocalDb, entity: string, id: string): Promise<boolean> {
    const rows = await db.query("SELECT 1 FROM outbox WHERE status = 'pending' AND entity = ? AND id = ? LIMIT 1", [entity, id])
    return rows.length > 0
  },
}
