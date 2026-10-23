import { questionnaireTemplateSchema, type QuestionnaireTemplate } from '../domain/questionnaireTemplate'
import { applyPulled, nextClientUpdatedAt, type SyncEntityAdapter } from './entities'
import { newId } from './ids'
import type { LocalDb } from './localDb'
import { outbox } from './outbox'

export const QUESTIONNAIRE_TEMPLATE_ENTITY = 'questionnaire_template'

/** The server's payload: `{ document }` (the document keeps camelCase keys, like the plans). */
interface QuestionnaireTemplatePayload {
  document: unknown
}

type Row = { id: string; document: string; client_updated_at: string; version: number | null; deleted_at: string | null }

export interface QuestionnaireTemplateLocal {
  id: string
  document: QuestionnaireTemplate
}

async function liveRow(db: LocalDb): Promise<Row | undefined> {
  const [row] = await db.query<Row>(
    'SELECT * FROM questionnaire_templates WHERE deleted_at IS NULL ORDER BY client_updated_at DESC, id LIMIT 1',
  )
  return row
}

async function writeRow(db: LocalDb, id: string, document: unknown, clientUpdatedAt: string, version: number | null) {
  await db.execute(
    `INSERT INTO questionnaire_templates (id, document, client_updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       document = excluded.document, client_updated_at = excluded.client_updated_at,
       version = COALESCE(excluded.version, questionnaire_templates.version), deleted_at = NULL`,
    [id, JSON.stringify(document), clientUpdatedAt, version],
  )
}

/** The user's update questionnaire template: one live per user, edited on the device and synced. */
export const questionnaireTemplateRepo = {
  /** The live template, or null (none yet, or a stored document this version cannot read). */
  async get(db: LocalDb): Promise<QuestionnaireTemplateLocal | null> {
    const row = await liveRow(db)
    if (!row) return null
    const parsed = questionnaireTemplateSchema.safeParse(JSON.parse(row.document))
    return parsed.success ? { id: row.id, document: parsed.data } : null
  },

  /**
   * Validates and stores the template (creating it, or replacing the live one) and queues it, in one transaction.
   * Throws RangeError without any of the template's text when it is invalid. Returns the template's id.
   */
  async save(db: LocalDb, document: QuestionnaireTemplate, now: Date): Promise<string> {
    const parsed = questionnaireTemplateSchema.safeParse(document)
    if (!parsed.success) throw new RangeError('Invalid template')
    const payload: QuestionnaireTemplatePayload = { document: parsed.data }
    return db.transaction(async (tx) => {
      const row = await liveRow(tx)
      const id = row?.id ?? newId()
      const clientUpdatedAt = nextClientUpdatedAt(now, row?.client_updated_at)
      await writeRow(tx, id, parsed.data, clientUpdatedAt, null)
      await outbox.enqueue(tx, { entity: QUESTIONNAIRE_TEMPLATE_ENTITY, id, op: 'upsert', payload: JSON.stringify(payload), clientUpdatedAt })
      return id
    })
  },
}

export const questionnaireTemplateSync: SyncEntityAdapter = {
  entity: QUESTIONNAIRE_TEMPLATE_ENTITY,
  table: 'questionnaire_templates',
  applyRemote: (db, record) =>
    applyPulled(db, QUESTIONNAIRE_TEMPLATE_ENTITY, 'questionnaire_templates', record, (payload, clientUpdatedAt) =>
      writeRow(db, record.id, (payload as QuestionnaireTemplatePayload).document, clientUpdatedAt, record.version),
    ),
}
