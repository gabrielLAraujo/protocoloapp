import { applyPulled, nextClientUpdatedAt, normalizeTimestamp, type SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const UPDATE_CYCLE_ENTITY = 'update_cycle'
export const MAX_ANSWERS = 300
export const MAX_ANSWER_LENGTH = 4000
export const MAX_PHOTOS = 40

const ANSWER_KEY = /^[a-z0-9_]{1,64}$/
const POSE_KEY = /^[a-z0-9_]{1,32}$/

export type UpdateCycleStatus = 'collecting' | 'draft' | 'sent'

const STATUS_RANK: Record<UpdateCycleStatus, number> = { collecting: 0, draft: 1, sent: 2 }

export interface UpdateCyclePhoto {
  pose: string
  fileId: string
  /** ISO timestamp. */
  takenAt: string
}

/** An answer with its own clock: `text` null is a removed answer (it still wins over an older text elsewhere). */
export interface AnswerEntry {
  text: string | null
  /** ISO timestamp of the change that wrote it. */
  at: string
}

export interface UpdateCycleLocal {
  id: string
  protocolVersionId: string
  /** yyyy-MM-dd. */
  periodStart: string
  /** yyyy-MM-dd (the protocol's update date). */
  periodEnd: string
  status: UpdateCycleStatus
  /** Question key -> answer text (the live answers). */
  answers: Record<string, string>
  photos: UpdateCyclePhoto[]
  /** ISO timestamp, null until sent. */
  sentAt: string | null
  clientUpdatedAt: string
}

type StoredPhoto = UpdateCyclePhoto & { updatedAt: string }

/**
 * What the device keeps of a cycle: every answer and photo with its own clock, so two devices editing different
 * questions (or poses) merge instead of one overwriting the other (the server merges the same way).
 */
interface CycleState {
  protocolVersionId: string
  periodStart: string
  periodEnd: string
  status: UpdateCycleStatus
  entries: Record<string, AnswerEntry>
  photos: StoredPhoto[]
  sentAt: string | null
}

/**
 * The server's payload (snake_case). protocol_version_id and the period are the server's: a push of them is ignored.
 * `answer_entries` and the photos' `updated_at` carry the clocks; `answers` (the live texts) is kept for older readers.
 */
interface UpdateCyclePayload {
  protocol_version_id: string
  period_start: string
  period_end: string
  status: UpdateCycleStatus
  answers: Record<string, string> | null
  answer_entries?: Record<string, { text: string | null; at: string }> | null
  photos: { pose: string; file_id: string; taken_at: string; updated_at?: string | null }[] | null
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

const iso = (value: string) => new Date(value).toISOString()
const day = (value: string) => value.slice(0, 10)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Entries from either shape: `{key: {text, at}}`, or the older `{key: text}` (dated `fallbackAt`). */
function readEntries(raw: unknown, fallbackAt: string): Record<string, AnswerEntry> {
  const out: Record<string, AnswerEntry> = {}
  if (!isRecord(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = { text: value, at: fallbackAt }
    else if (isRecord(value) && typeof value.at === 'string' && (typeof value.text === 'string' || value.text === null))
      out[key] = { text: value.text, at: iso(value.at) }
  }
  return out
}

/** Photos from either the local shape (camelCase) or the payload's (snake_case); without a clock, `fallbackAt`. */
function readPhotos(raw: unknown, fallbackAt: string): StoredPhoto[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((p) => ({
    pose: String(p.pose),
    fileId: String(p.fileId ?? p.file_id),
    takenAt: iso(String(p.takenAt ?? p.taken_at)),
    updatedAt: typeof (p.updatedAt ?? p.updated_at) === 'string' ? iso(String(p.updatedAt ?? p.updated_at)) : fallbackAt,
  }))
}

const liveAnswers = (entries: Record<string, AnswerEntry>): Record<string, string> =>
  Object.fromEntries(Object.entries(entries).flatMap(([k, e]) => (e.text === null ? [] : [[k, e.text]])))

const fromRow = (row: Row): CycleState => ({
  protocolVersionId: row.protocol_version_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  status: row.status,
  entries: readEntries(JSON.parse(row.answers), row.client_updated_at),
  photos: readPhotos(JSON.parse(row.photos), row.client_updated_at),
  sentAt: row.sent_at,
})

function fromPayload(p: UpdateCyclePayload, fallbackAt: string): CycleState {
  return {
    protocolVersionId: p.protocol_version_id,
    periodStart: day(p.period_start),
    periodEnd: day(p.period_end),
    status: p.status,
    entries: readEntries(p.answer_entries ?? p.answers, fallbackAt),
    photos: readPhotos(p.photos, fallbackAt),
    sentAt: p.sent_at === null ? null : iso(p.sent_at),
  }
}

const toLocal = (row: Row): UpdateCycleLocal => {
  const state = fromRow(row)
  return {
    id: row.id,
    protocolVersionId: state.protocolVersionId,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
    status: state.status,
    answers: liveAnswers(state.entries),
    photos: state.photos.map(({ pose, fileId, takenAt }) => ({ pose, fileId, takenAt })),
    sentAt: state.sentAt,
    clientUpdatedAt: row.client_updated_at,
  }
}

const toPayload = (c: CycleState): UpdateCyclePayload => ({
  protocol_version_id: c.protocolVersionId,
  period_start: c.periodStart,
  period_end: c.periodEnd,
  status: c.status,
  answers: liveAnswers(c.entries),
  answer_entries: c.entries,
  photos: c.photos.map((p) => ({ pose: p.pose, file_id: p.fileId, taken_at: p.takenAt, updated_at: p.updatedAt })),
  sent_at: c.sentAt,
})

const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b)

/**
 * The same merge as the server's: per answer key and per pose the newer clock wins (a tie keeps `remote`, the server's
 * copy); the status only moves forward (collecting, draft, sent); the period and the protocol are the remote's.
 */
function mergeCycle(local: CycleState, remote: CycleState): CycleState {
  const entries = { ...remote.entries }
  for (const [key, entry] of Object.entries(local.entries)) {
    const other = entries[key]
    if (!other || newer(entry.at, other.at)) entries[key] = entry
  }
  const photos = new Map(remote.photos.map((p) => [p.pose, p]))
  for (const photo of local.photos) {
    const other = photos.get(photo.pose)
    if (!other || newer(photo.updatedAt, other.updatedAt)) photos.set(photo.pose, photo)
  }
  const status = STATUS_RANK[local.status] > STATUS_RANK[remote.status] ? local.status : remote.status
  return {
    ...remote,
    status,
    entries,
    photos: [...photos.values()],
    sentAt: status === 'sent' ? (remote.sentAt ?? local.sentAt) : null,
  }
}

/** Same rules as the server's validator. The messages never carry the answers. */
function checkAnswers(entries: Record<string, AnswerEntry>) {
  const list = Object.entries(entries)
  if (list.length > MAX_ANSWERS) throw new RangeError('Too many answers')
  for (const [key, { text }] of list) {
    if (!ANSWER_KEY.test(key)) throw new RangeError('Invalid answer key')
    if (text !== null && (typeof text !== 'string' || text.length > MAX_ANSWER_LENGTH)) throw new RangeError('Invalid answer')
  }
}

async function writeRow(db: LocalDb, id: string, c: CycleState, clientUpdatedAt: string, version: number | null) {
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
      c.protocolVersionId,
      c.periodStart,
      c.periodEnd,
      c.status,
      JSON.stringify(c.entries),
      JSON.stringify(c.photos),
      c.sentAt,
      clientUpdatedAt,
      version,
    ],
  )
}

/**
 * Applies `change` to a live cycle and queues the full payload (every entry with its clock), in one transaction. `fn`
 * gets the clock of this change for the entries it writes. Cycles are only created by the server.
 */
async function change(db: LocalDb, id: string, now: Date, fn: (cycle: CycleState, at: string) => CycleState): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.query<Row>('SELECT * FROM update_cycles WHERE id = ? AND deleted_at IS NULL', [id])
    if (!row) throw new RangeError('Unknown update cycle')
    const clientUpdatedAt = nextClientUpdatedAt(now, row.client_updated_at)
    const next = fn(fromRow(row), clientUpdatedAt)
    checkAnswers(next.entries)
    if (next.photos.length > MAX_PHOTOS) throw new RangeError('Too many photos')
    await writeRow(tx, id, next, clientUpdatedAt, null)
    await outbox.enqueue(tx, { entity: UPDATE_CYCLE_ENTITY, id, op: 'upsert', payload: JSON.stringify(toPayload(next)), clientUpdatedAt })
  })
}

/** The active protocol's version id first, then the latest period, then the most recently changed. */
const CURRENT_ORDER = `ORDER BY (protocol_version_id = (
    SELECT id FROM plan_versions WHERE kind = 'protocol' AND status = 'active' AND deleted_at IS NULL ORDER BY activated_at DESC LIMIT 1
  )) DESC, period_start DESC, client_updated_at DESC, COALESCE(version, 0) DESC, id`

export const updateCycleRepo = {
  /**
   * The live cycle of the active protocol when there is one; otherwise (or on a tie) the latest period_start, then the
   * most recently changed. Null when there is no live cycle.
   */
  async current(db: LocalDb): Promise<UpdateCycleLocal | null> {
    const [row] = await db.query<Row>(`SELECT * FROM update_cycles WHERE deleted_at IS NULL ${CURRENT_ORDER} LIMIT 1`)
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
    await change(db, id, now, (cycle, at) => ({
      ...cycle,
      entries: { ...cycle.entries, [key]: { text, at } },
      status: cycle.status === 'collecting' ? 'draft' : cycle.status,
    }))
  },

  /** Stores the photo of a pose, replacing the previous one of the same pose. */
  async setPhoto(db: LocalDb, id: string, photo: UpdateCyclePhoto, now: Date): Promise<void> {
    if (!POSE_KEY.test(photo.pose)) throw new RangeError('Invalid pose')
    await change(db, id, now, (cycle, at) => ({
      ...cycle,
      photos: [...cycle.photos.filter((p) => p.pose !== photo.pose), { ...photo, takenAt: iso(photo.takenAt), updatedAt: at }],
    }))
  },

  /**
   * Marks the cycle as sent with the final answers (calculated ones included): only the answers that differ get the clock
   * of this change, so an answer edited meanwhile on another device and not shown here is not overwritten by an old copy.
   */
  async markSent(db: LocalDb, id: string, answers: Record<string, string>, now: Date): Promise<void> {
    await change(db, id, now, (cycle, at) => {
      const entries = { ...cycle.entries }
      for (const [key, text] of Object.entries(answers)) if (entries[key]?.text !== text) entries[key] = { text, at }
      return { ...cycle, entries, status: 'sent', sentAt: now.toISOString() }
    })
  },
}

/**
 * Pull only: the server creates the cycles (on protocol activation), the device never does. A pulled cycle is merged into
 * the local one per answer and per pose (mergeCycle), so a pending local edit is kept next to what other devices wrote.
 */
export const updateCycleSync: SyncEntityAdapter = {
  entity: UPDATE_CYCLE_ENTITY,
  table: 'update_cycles',
  async applyRemote(db, record) {
    if (record.deletedAt !== null || record.payload === null)
      return applyPulled(db, UPDATE_CYCLE_ENTITY, 'update_cycles', record, () => Promise.resolve())
    const [local] = await db.query<Row>('SELECT * FROM update_cycles WHERE id = ?', [record.id])
    if (local?.version != null && record.version <= local.version) return
    const at = normalizeTimestamp(record.clientUpdatedAt)
    const remote = fromPayload(record.payload as UpdateCyclePayload, at)
    const live = local && local.deleted_at === null
    const next = live ? mergeCycle(fromRow(local), remote) : remote
    const clientUpdatedAt = live && newer(local.client_updated_at, at) ? local.client_updated_at : at
    await writeRow(db, record.id, next, clientUpdatedAt, record.version)
  },
}
