import type { ApiClient, SyncChange, SyncRecord } from './apiClient'
import type { SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'
import { outbox, type OutboxEntry } from './outbox'
import { syncEntities } from './registry'
import { syncState } from './syncState'
import { onOnline, onResume } from '../platform/lifecycle'

export type SyncRunResult = { pushed: number; pulled: number; rejected: number; offline: boolean }

export type SyncStatus = { pending: number; rejected: number; lastSyncAt?: string; running: boolean }

/** Server limits: at most 500 changes per push and 500 records per pull page. */
export const PUSH_BATCH = 500
export const PULL_LIMIT = 500
export const SYNC_INTERVAL_MS = 60_000

/** Why a run stopped early. `offline`: no network (entries in backoff). `unauthorized`: the session is gone. */
type Stop = 'offline' | 'unauthorized' | 'server'

class StopRun extends Error {
  readonly reason: Stop

  constructor(reason: Stop) {
    super(reason)
    this.reason = reason
  }
}

/**
 * Client side of the sync: pushes the outbox, then pulls everything newer than `last_since`.
 *
 * - A push batch is answered with one result per change, in order. applied/stale → ack; rejected → attention list,
 *   never retried. Network failure or 5xx → the batch stays, with backoff. 401 (after the api client's own refresh)
 *   → the run stops without backoff; the client's auth:logout handles the session.
 * - The pull applies each page and advances `last_since` in one transaction, so a crash never skips records.
 * - One run at a time: a call while a run is in flight gets that run's result.
 */
export class SyncEngine {
  private readonly db: LocalDb
  private readonly api: ApiClient
  private readonly clock: () => Date
  private readonly adapters: Map<string, SyncEntityAdapter>
  private readonly listeners = new Set<(status: SyncStatus) => void>()
  private current: Promise<SyncRunResult> | null = null
  private publishing: Promise<void> = Promise.resolve()
  private status: SyncStatus = { pending: 0, rejected: 0, running: false }

  constructor(db: LocalDb, api: ApiClient, clock: () => Date = () => new Date(), adapters: readonly SyncEntityAdapter[] = syncEntities) {
    this.db = db
    this.api = api
    this.clock = clock
    this.adapters = new Map(adapters.map((adapter) => [adapter.entity, adapter]))
  }

  /**
   * Runs the sync, or joins the run in flight. A plain run honors the retry backoff of failed entries (the timer uses it);
   * `ignoreBackoff` is for moments when waiting is pointless (the user pressed "sync now", the network came back) and
   * sends them at once.
   */
  runOnce(options: { ignoreBackoff?: boolean } = {}): Promise<SyncRunResult> {
    this.current ??= (async () => {
      try {
        return await this.run(options.ignoreBackoff === true)
      } finally {
        await this.publish({ running: false }).catch(() => undefined)
        this.current = null
      }
    })()
    return this.current
  }

  /** Resolves when no run is in flight. */
  async whenIdle(): Promise<void> {
    while (this.current) await this.current.catch(() => undefined)
  }

  /**
   * Runs now, every 60 s, when the device comes back online and when the app returns to the foreground (all but the
   * timer ignore the retry backoff). The returned stop() ends the schedule and resolves once the run in flight (if any) has finished writing.
   */
  start(): () => Promise<void> {
    const kick = (ignoreBackoff: boolean) => {
      this.runOnce({ ignoreBackoff }).catch((error: unknown) => console.error('sync failed', error))
    }
    kick(true)
    const timer = setInterval(() => kick(false), SYNC_INTERVAL_MS)
    const offOnline = onOnline(() => kick(true))
    const offResume = onResume(() => kick(true))
    return () => {
      clearInterval(timer)
      offOnline()
      offResume()
      return this.whenIdle()
    }
  }

  subscribe(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    this.publish({}).catch(() => undefined)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private async run(ignoreBackoff: boolean): Promise<SyncRunResult> {
    await this.publish({ running: true })
    const result: SyncRunResult = { pushed: 0, pulled: 0, rejected: 0, offline: false }
    try {
      if (ignoreBackoff) await outbox.releaseBackoff(this.db)
      await this.replayUnknown()
      await this.push(result)
      await this.pull(result)
      const at = this.clock().toISOString()
      await syncState.set(this.db, 'last_sync_at', at)
    } catch (error) {
      if (!(error instanceof StopRun)) throw error
      result.offline = error.reason === 'offline'
    }
    return result
  }

  private async push(result: SyncRunResult): Promise<void> {
    for (;;) {
      const entries = await outbox.due(this.db, this.clock(), PUSH_BATCH)
      if (entries.length === 0) return
      await this.send(entries, result)
    }
  }

  /**
   * Sends one batch. A 400 refuses the whole batch for one malformed change: the batch is split in halves (in order)
   * until the culprit is alone, and only that one goes to the attention list.
   */
  private async send(entries: OutboxEntry[], result: SyncRunResult): Promise<void> {
    const seqs = entries.map((e) => e.seq)

    let response
    try {
      response = await this.api.POST('/api/sync/push', { body: { changes: entries.map(toChange) } })
    } catch {
      await outbox.fail(this.db, seqs, this.clock())
      throw new StopRun('offline')
    }

    if (response.response.status === 401) throw new StopRun('unauthorized')
    if (response.response.status === 400) {
      if (entries.length === 1) {
        await outbox.reject(this.db, entries[0]!.seq, ['invalid_request'])
        result.rejected++
        return
      }
      const middle = Math.ceil(entries.length / 2)
      await this.send(entries.slice(0, middle), result)
      await this.send(entries.slice(middle), result)
      return
    }
    const results = response.data?.results
    // 5xx, 429 or an answer that does not line up with the batch: keep the entries, retry later.
    if (!response.response.ok || !results || results.length !== entries.length || results.some((r, i) => r.id !== entries[i]!.id)) {
      await outbox.fail(this.db, seqs, this.clock())
      throw new StopRun('server')
    }

    await this.db.transaction(async (tx) => {
      const done: number[] = []
      for (const [i, r] of results.entries()) {
        const entry = entries[i]!
        if (r.status === 'rejected') {
          await outbox.reject(tx, entry.seq, r.errors ?? [])
          result.rejected++
        } else {
          done.push(entry.seq)
          result.pushed++
        }
      }
      await outbox.ack(tx, done)
    })
  }

  private async pull(result: SyncRunResult): Promise<void> {
    let since = Number((await syncState.get(this.db, 'last_since')) ?? 0)
    for (;;) {
      let response
      try {
        response = await this.api.GET('/api/sync/pull', { params: { query: { since, limit: PULL_LIMIT } } })
      } catch {
        throw new StopRun('offline')
      }
      if (response.response.status === 401) throw new StopRun('unauthorized')
      if (!response.response.ok || !response.data) throw new StopRun('server')

      const page = response.data
      await this.db.transaction(async (tx) => {
        for (const record of page.records) await this.apply(tx, record)
        await syncState.set(tx, 'last_since', String(page.nextSince))
      })
      result.pulled += page.records.length
      if (!page.hasMore || page.nextSince === since) return
      since = page.nextSince
    }
  }

  private async apply(tx: LocalDb, record: SyncRecord): Promise<void> {
    const adapter = this.adapters.get(record.entity)
    if (adapter) return adapter.applyRemote(tx, record)
    // Records come in version order, so the last one kept is the newest.
    await tx.execute(
      `INSERT INTO sync_unknown (entity, id, record) VALUES (?, ?, ?)
       ON CONFLICT (entity, id) DO UPDATE SET record = excluded.record`,
      [record.entity, record.id, JSON.stringify(record)],
    )
  }

  /** Applies records kept by an older app version for entities this version knows. */
  private async replayUnknown(): Promise<void> {
    if (this.adapters.size === 0) return
    const entities = [...this.adapters.keys()]
    const marks = entities.map(() => '?').join(', ')
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ record: string }>(`SELECT record FROM sync_unknown WHERE entity IN (${marks})`, entities)
      if (rows.length === 0) return
      const records = rows.map((row) => JSON.parse(row.record) as SyncRecord).sort((a, b) => a.version - b.version)
      for (const record of records) await this.apply(tx, record)
      await tx.execute(`DELETE FROM sync_unknown WHERE entity IN (${marks})`, entities)
    })
  }

  /** Publishes in call order (each waits for the previous), so a slow read never overwrites a newer status. */
  private publish(patch: Partial<SyncStatus>): Promise<void> {
    const next = this.publishing.then(() => this.readStatus(patch))
    this.publishing = next.catch(() => undefined)
    return next
  }

  private async readStatus(patch: Partial<SyncStatus>): Promise<void> {
    const [pending, rejected, lastSyncAt] = await Promise.all([
      outbox.pendingCount(this.db),
      outbox.rejectedCount(this.db),
      syncState.get(this.db, 'last_sync_at'),
    ])
    this.status = { ...this.status, ...patch, pending, rejected, ...(lastSyncAt ? { lastSyncAt } : {}) }
    for (const fn of this.listeners) fn(this.status)
  }
}

const toChange = (entry: OutboxEntry): SyncChange => ({
  entity: entry.entity,
  id: entry.id,
  op: entry.op,
  payload: entry.payload === null ? null : (JSON.parse(entry.payload) as unknown),
  clientUpdatedAt: entry.clientUpdatedAt,
})
