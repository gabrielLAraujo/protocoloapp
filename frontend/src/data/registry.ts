import { adherenceLogSync } from './adherenceRepo'
import { dailyCheckinSync } from './dailyCheckinRepo'
import { dietDeviationSync } from './dietDeviationRepo'
import type { SyncEntityAdapter } from './entities'
import { exerciseSync } from './exerciseRepo'
import { planVersionSync } from './planRepo'
import { questionnaireTemplateSync } from './questionnaireTemplateRepo'
import { rotationOverrideSync } from './rotationOverrideRepo'
import { scheduleSlotSync } from './scheduleRepo'
import { updateCycleSync } from './updateCycleRepo'
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
  scheduleSlotSync,
  adherenceLogSync,
  dietDeviationSync,
  questionnaireTemplateSync,
  updateCycleSync,
]
