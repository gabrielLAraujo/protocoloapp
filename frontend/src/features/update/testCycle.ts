import type { SyncRecord } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { updateCycleSync, type UpdateCycleStatus } from '../../data/updateCycleRepo'

/** Fictitious ids and a fictitious cycle, as the server would pull it. */
export const CYCLE_ID = '00000000-0000-0000-0000-000000000001'
export const PREVIOUS_CYCLE_ID = '00000000-0000-0000-0000-0000000000a0'
const PROTOCOL_ID = '7d1f2a10-0000-5000-8000-0000000000d1'

export async function seedCycle(
  db: LocalDb,
  {
    id = CYCLE_ID,
    periodStart = '2026-10-01',
    periodEnd = '2026-10-23',
    status = 'collecting',
    answers = {},
    photos = [],
    sentAt = null,
  }: {
    id?: string
    periodStart?: string
    periodEnd?: string
    status?: UpdateCycleStatus
    answers?: Record<string, string>
    photos?: { pose: string; file_id: string; taken_at: string }[]
    sentAt?: string | null
  } = {},
) {
  const record: SyncRecord = {
    entity: 'update_cycle',
    id,
    version: 1,
    payload: { protocol_version_id: PROTOCOL_ID, period_start: periodStart, period_end: periodEnd, status, answers, photos, sent_at: sentAt },
    deletedAt: null,
    clientUpdatedAt: '2026-10-01T12:00:00.000000+00:00',
  }
  await updateCycleSync.applyRemote(db, record)
}
