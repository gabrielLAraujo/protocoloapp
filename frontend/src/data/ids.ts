import { v4, v5 } from 'uuid'

/** Fixed namespace of the deterministic check-in ids. Never change it: ids already stored would no longer match. */
export const CHECKIN_NAMESPACE = '6f1c0b8e-3a52-4d7e-9a61-1f2b8c7d4e90'

/**
 * The id of a user's check-in for a date (yyyy-MM-dd). Two devices creating the same day offline produce the same id,
 * so they converge on one record. The user id is part of the name because ids are global primary keys on the server.
 */
export function checkinIdForDate(userId: string, date: string): string {
  return v5(`${userId}:daily_checkin:${date}`, CHECKIN_NAMESPACE)
}

/** The id of a user's rotation override for a date (yyyy-MM-dd): one per day, the same on every device. */
export function rotationOverrideIdForDate(userId: string, date: string): string {
  return v5(`${userId}:rotation_override:${date}`, CHECKIN_NAMESPACE)
}

/** The id of a user's time for a slot on a type of day (`training` | `off`): one per pair, the same on every device. */
export function scheduleSlotId(userId: string, slot: string, dayType: string): string {
  return v5(`${userId}:schedule:${slot}:${dayType}`, CHECKIN_NAMESPACE)
}

/** The id of a user's mark of one target on a date (yyyy-MM-dd): one per target and day, the same on every device. */
export function adherenceLogId(userId: string, date: string, targetType: string, targetKey: string): string {
  return v5(`${userId}:adherence:${date}:${targetType}:${targetKey}`, CHECKIN_NAMESPACE)
}

/** A new random id for records without a natural key (sessions, sets, exercise changes). */
export const newId = (): string => v4()
