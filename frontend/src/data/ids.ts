import { v5 } from 'uuid'

/** Fixed namespace of the deterministic check-in ids. Never change it: ids already stored would no longer match. */
export const CHECKIN_NAMESPACE = '6f1c0b8e-3a52-4d7e-9a61-1f2b8c7d4e90'

/**
 * The id of a user's check-in for a date (yyyy-MM-dd). Two devices creating the same day offline produce the same id,
 * so they converge on one record. The user id is part of the name because ids are global primary keys on the server.
 */
export function checkinIdForDate(userId: string, date: string): string {
  return v5(`${userId}:daily_checkin:${date}`, CHECKIN_NAMESPACE)
}
