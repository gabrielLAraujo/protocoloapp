import type { SessionLocal } from '../../data/workoutRepo'
import { activePlanAt } from '../../domain/rotation'
import type { WorkoutPlanEntry } from './workoutPlans'

/** Seconds between two sets logged afterwards: keeps their order (and "Última vez") without inventing a workout length. */
const STEP_MS = 1000

/** The start given to a workout of an earlier day logged afterwards: noon of that (local) day. */
export function loggedStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

/** A session created by "Registrar treino de outro dia" (it starts exactly at loggedStart of its date). */
export const isLoggedSession = (session: Pick<SessionLocal, 'date' | 'startedAt'>): boolean =>
  session.startedAt === loggedStart(session.date).toISOString()

/** When the next set of a session edited afterwards is recorded: just after its start and every set already in it. */
export function nextLogTime(sets: readonly { completedAt: string }[], startedAt: string): Date {
  const latest = sets.reduce((max, s) => Math.max(max, Date.parse(s.completedAt)), Date.parse(startedAt))
  return new Date(latest + STEP_MS)
}
/** The plan to log a day with: the version active on it, else (a day before the first activation) the oldest one. */
export function planForDay(date: string, plans: readonly WorkoutPlanEntry[]): WorkoutPlanEntry | undefined {
  const at = activePlanAt(
    date,
    plans.map((p) => p.at),
  )
  return plans.find((p) => p.id === at?.planVersionId) ?? plans[0]
}

