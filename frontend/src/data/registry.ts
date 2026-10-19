import { dailyCheckinSync } from './dailyCheckinRepo'
import type { SyncEntityAdapter } from './entities'
import { exerciseSync } from './exerciseRepo'
import { planVersionSync } from './planRepo'
import { rotationOverrideSync } from './rotationOverrideRepo'
import { exerciseChangeSync, setLogSync, workoutSessionSync } from './workoutRepo'

/** Every entity this app version syncs. Add new ones here. */
export const syncEntities: readonly SyncEntityAdapter[] = [
  dailyCheckinSync,
  planVersionSync,
  exerciseSync,
  workoutSessionSync,
  setLogSync,
  exerciseChangeSync,
  rotationOverrideSync,
]
