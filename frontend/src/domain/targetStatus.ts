import { CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY, LEGACY_CHECKIN_KEY, type AdherenceTargetType, type DayTarget } from './dayPlan'

/**
 * The state of a day's target as Hoje, the Resumo and the gamification read it: the stored mark, or the one derived
 * from other data (a finished workout session, a saved check-in part). One rule for every screen.
 */

export type TargetStatus = 'done' | 'partial' | 'missed'

/** What is known about a day besides its marks. */
export interface DerivedDone {
  /** A session of the day was finished with at least one working set. */
  workoutDone: boolean
  /** Which parts of the day's check-in are saved (a full check-in from before the split counts as both). */
  checkinParts: { morning: boolean; evening: boolean }
}

/** Finds the day's mark of a target (type + key), or null. */
export type MarkLookup<L extends { status: TargetStatus }> = (type: AdherenceTargetType, key: string) => L | null

/** Map key of a target: `type:key`. */
export const targetId = (t: Pick<DayTarget, 'type' | 'key'>): string => `${t.type}:${t.key}`

function checkinPartSaved(key: string, parts: DerivedDone['checkinParts']): boolean {
  if (key === CHECKIN_MORNING_KEY) return parts.morning
  if (key === CHECKIN_EVENING_KEY) return parts.evening
  return false
}

/**
 * The mark of `target` (the legacy `checkin` mark stands for the evening check-in when the part has none of its own) and
 * its status: a finished workout or a saved check-in part makes the target done whatever its mark says.
 */
export function resolveTargetStatus<L extends { status: TargetStatus }>(
  target: Pick<DayTarget, 'type' | 'key'>,
  find: MarkLookup<L>,
  derived: DerivedDone,
): { log: L | null; status: TargetStatus | null } {
  const log = find(target.type, target.key) ?? (target.type === 'checkin' && target.key === CHECKIN_EVENING_KEY ? find('checkin', LEGACY_CHECKIN_KEY) : null)
  let status = log?.status ?? null
  if (target.type === 'workout' && derived.workoutDone) status = 'done'
  if (target.type === 'checkin' && checkinPartSaved(target.key, derived.checkinParts)) status = 'done'
  return { log, status }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** HH:mm of `now` on the device clock. */
export const clockOf = (now: Date): string => `${pad2(now.getHours())}:${pad2(now.getMinutes())}`

/**
 * Whether a target counts as planned in a rate or score. A closed day counts everything; today (`clock` = HH:mm now)
 * only what is marked or whose time has come, so the morning does not read low. Untimed and unmarked: not yet.
 */
export function countsAsPlanned(target: Pick<DayTarget, 'time'>, status: TargetStatus | null | undefined, clock: string | null): boolean {
  if (clock === null || status != null) return true
  return target.time !== null && target.time <= clock
}
