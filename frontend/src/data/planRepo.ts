import { applyPulled, type SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'

export const PLAN_VERSION_ENTITY = 'plan_version'

export type PlanKind = 'protocol' | 'workout'
export type PlanStatus = 'draft' | 'active' | 'archived'

export interface PlanVersionLocal {
  id: string
  kind: PlanKind
  status: PlanStatus
  /** The plan document as the server sends it (camelCase keys inside; see the API's plan document types). */
  document: unknown
  /** JSON paths of the fields the extraction was unsure about. */
  lowConfidence: string[]
  /** ISO timestamp, null until activated. */
  activatedAt: string | null
  clientUpdatedAt: string
}

/** The server's pull payload (snake_case). */
interface PlanVersionPayload {
  kind: PlanKind
  status: PlanStatus
  document: unknown
  activated_at: string | null
  low_confidence: string[] | null
}

type Row = {
  id: string
  kind: PlanKind
  status: PlanStatus
  document: string
  low_confidence: string
  activated_at: string | null
  client_updated_at: string
}

const toPlan = (row: Row): PlanVersionLocal => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  document: JSON.parse(row.document) as unknown,
  lowConfidence: JSON.parse(row.low_confidence) as string[],
  activatedAt: row.activated_at,
  clientUpdatedAt: row.client_updated_at,
})

/** Plans are written by the server only: the device never changes them, it just keeps what the pull brings. */
export const planRepo = {
  /** The active version of the kind, or null. */
  async getActive(db: LocalDb, kind: PlanKind): Promise<PlanVersionLocal | null> {
    const [row] = await db.query<Row>(
      "SELECT * FROM plan_versions WHERE kind = ? AND status = 'active' AND deleted_at IS NULL ORDER BY activated_at DESC LIMIT 1",
      [kind],
    )
    return row ? toPlan(row) : null
  },

  /** Every live version of the kind (draft, active, archived), newest activation first, drafts on top. */
  async list(db: LocalDb, kind: PlanKind): Promise<PlanVersionLocal[]> {
    const rows = await db.query<Row>(
      `SELECT * FROM plan_versions WHERE kind = ? AND deleted_at IS NULL
       ORDER BY (activated_at IS NOT NULL), activated_at DESC, client_updated_at DESC`,
      [kind],
    )
    return rows.map(toPlan)
  },

  async byId(db: LocalDb, id: string): Promise<PlanVersionLocal | null> {
    const [row] = await db.query<Row>('SELECT * FROM plan_versions WHERE id = ? AND deleted_at IS NULL', [id])
    return row ? toPlan(row) : null
  },
}

export const planVersionSync: SyncEntityAdapter = {
  entity: PLAN_VERSION_ENTITY,
  table: 'plan_versions',
  applyRemote: (db, record) =>
    applyPulled(db, PLAN_VERSION_ENTITY, 'plan_versions', record, async (payload, clientUpdatedAt) => {
      const p = payload as PlanVersionPayload
      await db.execute(
        `INSERT INTO plan_versions (id, kind, status, document, low_confidence, activated_at, client_updated_at, version, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET
           kind = excluded.kind, status = excluded.status, document = excluded.document,
           low_confidence = excluded.low_confidence, activated_at = excluded.activated_at,
           client_updated_at = excluded.client_updated_at, version = excluded.version, deleted_at = NULL`,
        [
          record.id,
          p.kind,
          p.status,
          JSON.stringify(p.document),
          JSON.stringify(p.low_confidence ?? []),
          p.activated_at === null ? null : new Date(p.activated_at).toISOString(),
          clientUpdatedAt,
          record.version,
        ],
      )
    }),
}
