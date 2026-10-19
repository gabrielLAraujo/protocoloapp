import { parseProtocolDocument, type ProtocolDocument } from '../domain/planDocuments'
import type { LocalDb } from './localDb'
import { planRepo, type PlanVersionLocal } from './planRepo'
import { scheduleRepo } from './scheduleRepo'

export interface ActiveProtocol {
  plan: PlanVersionLocal
  document: ProtocolDocument
}

/** The active protocol on the device (status active, latest activation), or null when there is none or it cannot be read. */
export async function loadActiveProtocol(db: LocalDb): Promise<ActiveProtocol | null> {
  const plan = await planRepo.getActive(db, 'protocol')
  if (!plan) return null
  const parsed = parseProtocolDocument(plan.document)
  return parsed.ok ? { plan, document: parsed.value } : null
}

/**
 * Creates the suggested times for the slots that have none yet (scheduleRepo.ensureDefaults) for `protocol`, or for the
 * active protocol when it is not given. The caller syncs afterwards: the server's reminders read these rows.
 */
export async function ensureScheduleDefaults(db: LocalDb, userId: string, protocol?: ProtocolDocument | null): Promise<number> {
  const document = protocol === undefined ? ((await loadActiveProtocol(db))?.document ?? null) : protocol
  return scheduleRepo.ensureDefaults(db, userId, document)
}
