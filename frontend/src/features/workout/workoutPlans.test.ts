import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { activePlanAt } from '../../domain/rotation'
import { newLocalDb } from '../../test/localDb'
import { workoutDoc } from './testData'
import { loadWorkoutPlans } from './workoutPlans'

const OLD = '7d1f2a10-0000-5000-8000-0000000000d1'
const NEW = '7d1f2a10-0000-5000-8000-0000000000d2'

async function seed(db: LocalDb, id: string, status: 'active' | 'archived', activatedAt: Date) {
  await planVersionSync.applyRemote(db, {
    entity: 'plan_version',
    id,
    version: 1,
    payload: { kind: 'workout', status, document: workoutDoc(['a', 'b']), activated_at: activatedAt.toISOString(), low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
  })
}

describe('loadWorkoutPlans', () => {
  let db: LocalDb
  beforeEach(async () => {
    db = await newLocalDb()
  })

  it('same-day re-activation: the newest activation wins', async () => {
    await seed(db, NEW, 'active', new Date(2026, 9, 12, 18))
    await seed(db, OLD, 'archived', new Date(2026, 9, 12, 9))
    const plans = await loadWorkoutPlans(db)
    expect(plans.map((p) => p.id)).toEqual([OLD, NEW])
    expect(activePlanAt('2026-10-12', plans.map((p) => p.at))?.planVersionId).toBe(NEW)
  })
})
