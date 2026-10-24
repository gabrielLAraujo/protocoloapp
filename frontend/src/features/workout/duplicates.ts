import type { SessionSummary } from '../../data/workoutRepo'

/** A workout recorded twice: once in the app and once in Hevy. */
export interface DuplicatePair {
  app: SessionSummary
  hevy: SessionSummary
}

/**
 * Finished sessions of the same date and plan day (`planVersionId` + `dayKey`), one from the app and one from Hevy.
 * The rows are the live sessions of the History list; open ones are left out. One pair per date and plan day, with the
 * first session of each source in the given order, the pairs in the order their first session appears.
 */
export function findDuplicates(rows: readonly SessionSummary[]): DuplicatePair[] {
  const groups = new Map<string, { app?: SessionSummary; hevy?: SessionSummary }>()
  for (const row of rows) {
    const { session } = row
    if (session.endedAt === null) continue
    const key = JSON.stringify([session.date, session.planVersionId, session.dayKey])
    const group = groups.get(key) ?? {}
    group[session.source] ??= row
    groups.set(key, group)
  }
  const pairs: DuplicatePair[] = []
  for (const { app, hevy } of groups.values()) if (app && hevy) pairs.push({ app, hevy })
  return pairs
}
