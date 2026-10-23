import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const UPDATE_CYCLE_ENTITY = 'update_cycle'
export const MAX_ANSWERS = 300
export const MAX_ANSWER_LENGTH = 4000
export const MAX_PHOTOS = 40

const ANSWER_KEY = /^[a-z0-9_]{1,64}$/
const POSE_KEY = /^[a-z0-9_]{1,32}$/

export type UpdateCycleStatus = 'collecting' | 'draft' | 'sent'

export interface UpdateCyclePhoto {
  pose: string
  fileId: string
  /** ISO timestamp. */
  takenAt: string
}

export interface UpdateCycleLocal {
  id: string
  protocolVersionId: string
  /** yyyy-MM-dd. */
  periodStart: string
  /** yyyy-MM-dd (the protocol's update date). */
  periodEnd: string
  status: UpdateCycleStatus
  /** Question key -> answer text. */
  answers: Record<string, string>
  photos: UpdateCyclePhoto[]
  /** ISO timestamp, null until sent. */
  sentAt: string | null
  clientUpdatedAt: string
}

/** The server's payload (snake_case). protocol_version_id and the period are the server's: a push of them is ignored. */
interface UpdateCyclePayload {
  protocol_version_id: string
  period_start: string
  period_end: string
  status: UpdateCycleStatus
  answers: Record<string, string> | null
  photos: { pose: string; file_id: string; taken_at: string }[] | null
  sent_at: string | null
}

type Row = {
  id: string
  protocol_version_id: string
  period_start: string
  period_end: string
  status: UpdateCycleStatus
  answers: string
  photos: string
  sent_at: string | null
  client_updated_at: string
  version: number | null
  deleted_at: string | null
}

const toLocal = (row: Row): UpdateCycleLocal => ({
  id: row.id,
  protocolVersionId: row.protocol_version_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  status: row.status,
  answers: JSON.parse(row.answers) as Record<string, string>,
  photos: JSON.parse(row.photos) as UpdateCyclePhoto[],
  sentAt: row.sent_at,
  clientUpdatedAt: row.client_updated_at,
})

const toPayload = (c: UpdateCycleLocal): UpdateCyclePayload => ({
  protocol_version_id: c.protocolVersionId,
  period_start: c.periodStart,
  period_end: c.periodEnd,
  status: c.status,
  answers: c.answers,
  photos: c.photos.map((p) => ({ pose: p.pose, file_id: p.fileId, taken_at: p.takenAt })),
  sent_at: c.sentAt,
})

/** Same rules as the server's validator. The messages never carry the answers. */
function checkAnswers(answers: Record<string, string>) {
  const entries = Object.entries(answers)
  if (entries.length > MAX_ANSWERS) throw new RangeError('Too many answers')
  for (const [key, text] of entries) {
    if (!ANSWER_KEY.test(key)) throw new RangeError('Invalid answer key')
    if (typeof text !== 'string' || text.length > MAX_ANSWER_LENGTH) throw new RangeError('Invalid answer')
  }
}

const day = (iso: string) => iso.slice(0, 10)

async function writeRow(db: LocalDb, id: string, p: UpdateCyclePayload, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO update_cycles (id, protocol_version_id, period_start, period_end, status, answers, photos, sent_at, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       protocol_version_id = excluded.protocol_version_id, period_start = excluded.period_start, period_end = excluded.period_end,
       status = excluded.status, answers = excluded.answers, photos = excluded.photos, sent_at = excluded.sent_at,
       client_updated_at = excluded.client_updated_at,
       version = COALESCE(excluded.version, update_cycles.version), deleted_at = NULL`,
    [
      id,
      p.protocol_version_id,
      day(p.period_start),
      day(p.period_end),
      p.status,
      JSON.stringify(p.answers ?? {}),
      JSON.stringify((p.photos ?? []).map((x) => ({ pose: x.pose, fileId: x.file_id, takenAt: new Date(x.taken_at).toISOString() }))),
      p.sent_at === null ? null : new Date(p.sent_at).toISOString(),
      clientUpdatedAt,
      version,
    ],
  )
}

/** Applies `change` to a live cycle and queues the full payload, in one transaction. Cycles are only created by the server. */
async function change(db: LocalDb, id: string, now: Date, fn: (cycle: UpdateCycleLocal) => UpdateCycleLocal): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.query<Row>('SELECT * FROM update_cycles WHERE id = ? AND deleted_at IS NULL', [id])
    if (!row) throw new RangeError('Unknown update cycle')
    const next = fn(toLocal(row))
    checkAnswers(next.answers)
    if (next.photos.length > MAX_PHOTOS) throw new RangeError('Too many photos')
    const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
    const payload = toPayload(next)
    await writeRow(tx, id, payload, clientUpdatedAt, null)
    await outbox.enqueue(tx, { entity: UPDATE_CYCLE_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
  })
}

export const updateCycleRepo = {
  /** The live cycle with the latest period_start, or null. */
  async current(db: LocalDb): Promise<UpdateCycleLocal | null> {
    const [row] = await db.query<Row>('SELECT * FROM update_cycles WHERE deleted_at IS NULL ORDER BY period_start DESC, id LIMIT 1')
    return row ? toLocal(row) : null
  },

  async byId(db: LocalDb, id: string): Promise<UpdateCycleLocal | null> {
    const [row] = await db.query<Row>('SELECT * FROM update_cycles WHERE id = ? AND deleted_at IS NULL', [id])
    return row ? toLocal(row) : null
  },

  /** The live cycle right before `id` (latest period_start before its own), or null. */
  async previous(db: LocalDb, id: string): Promise<UpdateCycleLocal | null> {
    const [row] = await db.query<Row>(
      `SELECT * FROM update_cycles WHERE deleted_at IS NULL
         AND period_start < (SELECT period_start FROM update_cycles WHERE id = ?)
       ORDER BY period_start DESC, id LIMIT 1`,
      [id],
    )
    return row ? toLocal(row) : null
  },

  /** Stores (or with null removes) the answer of a question. A cycle still `collecting` becomes `draft`. */
  async setAnswer(db: LocalDb, id: string, key: string, text: string | null, now: Date): Promise<void> {
    if (!ANSWER_KEY.test(key)) throw new RangeError('Invalid answer key')
    await change(db, id, now, (cycle) => {
      const answers = { ...cycle.answers }
      if (text === null) delete answers[key]
      else answers[key] = text
      return { ...cycle, answers, status: cycle.status === 'collecting' ? 'draft' : cycle.status }
    })
  },

  /** Stores the photo of a pose, replacing the previous one of the same pose. */
  async setPhoto(db: LocalDb, id: string, photo: UpdateCyclePhoto, now: Date): Promise<void> {
    if (!POSE_KEY.test(photo.pose)) throw new RangeError('Invalid pose')
    await change(db, id, now, (cycle) => ({
      ...cycle,
      photos: [...cycle.photos.filter((p) => p.pose !== photo.pose), { ...photo, takenAt: new Date(photo.takenAt).toISOString() }],
    }))
  },

  /** Marks the cycle as sent with the final answers (calculated ones included). */
  async markSent(db: LocalDb, id: string, answers: Record<string, string>, now: Date): Promise<void> {
    await change(db, id, now, (cycle) => ({ ...cycle, answers: { ...answers }, status: 'sent', sentAt: now.toISOString() }))
  },
}

/** Pull only: the server creates the cycles (on protocol activation), the device never does. */
export const updateCycleSync: SyncEntityAdapter = {
  entity: UPDATE_CYCLE_ENTITY,
  table: 'update_cycles',
  applyRemote: (db, record) =>
    applyPulled(db, UPDATE_CYCLE_ENTITY, 'update_cycles', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, payload as UpdateCyclePayload, clientUpdatedAt, record.version),
    ),
}
