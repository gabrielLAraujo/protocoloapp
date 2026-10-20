import type { SyncRecord } from '../../data/apiClient'
import { adherenceRepo } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { addDays, dateRange } from '../../domain/calendarDate'
import { USER_A } from '../../test/localDb'

/**
 * A fictitious history for the gamification screens (tests only). Today is Tuesday 2026-10-27; the protocol (one meal,
 * nothing else) was activated on Monday 10-12. Every day from 10-12 to 10-26 has the meal and both check-in parts done,
 * except Wednesday 10-14 (nothing). So: the week of 10-12 is not on target, the week of 10-19 is perfect, and the streak
 * runs 10-15..10-26 (12 days; today does not break it).
 */
export const GAMI_TODAY = '2026-10-27'
export const GAMI_NOW = new Date(2026, 9, 27, 12, 0)

export async function seedGamificationHistory(db: LocalDb) {
  const record: SyncRecord = {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000f1',
    version: 1,
    payload: {
      kind: 'protocol',
      status: 'active',
      document: { phaseName: 'Fase teste', updateDate: '2026-11-15', meals: [{ key: '1', label: 'REF 1', items: [{ food: 'Ovos', grams: 100 }] }], items: [], cardio: null, guidelines: [] },
      activated_at: new Date(2026, 9, 12, 8).toISOString(),
      low_confidence: [],
    },
    deletedAt: null,
    clientUpdatedAt: '2026-10-12T11:00:00.000000+00:00',
  }
  await planVersionSync.applyRemote(db, record)
  for (const date of dateRange('2026-10-12', addDays(GAMI_TODAY, -1))) {
    if (date === '2026-10-14') continue
    const at = new Date(`${date}T20:00:00`)
    await adherenceRepo.mark(db, USER_A, { date, targetType: 'meal', targetKey: '1', status: 'done', reason: null, note: null }, at)
    await dailyCheckinRepo.saveMorning(db, USER_A, date, { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }, at)
    await dailyCheckinRepo.saveEvening(db, USER_A, date, { energyDay: 3, anxiety: 2, waterL: 3, note: null }, at)
  }
}
