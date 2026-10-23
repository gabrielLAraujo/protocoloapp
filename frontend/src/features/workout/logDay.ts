import type { SessionLocal } from '../../data/workoutRepo'

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
