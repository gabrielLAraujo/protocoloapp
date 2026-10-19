import { CARDIO_KEY, CHECKIN_KEY, WORKOUT_KEY } from '../domain/dayPlan'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from './adherenceRepo'
import { dailyCheckinRepo, type DailyCheckinFields } from './dailyCheckinRepo'
import type { LocalDb } from './localDb'
import { workoutRepo } from './workoutRepo'

/**
 * Writes that keep `adherence_log` in step with the screens that already record the same fact (a finished workout, the
 * check-in, cardio in the check-in). The server skips a reminder only when an adherence log exists for the target and
 * day, so these marks are what silence the "Hora do treino" / "Check-in do dia" / "Hora do cardio" pushes. Each runs
 * in one transaction: the row, the mark and their outbox entries are committed together or not at all.
 */

/**
 * Ends the session at `endedAt` and, when it has at least one working (non-warm-up) set, marks the workout of its day
 * done. An empty session is not a workout done (same rule as /treino and the summary).
 */
export async function finishSessionAndMark(db: LocalDb, userId: string, sessionId: string, endedAt: Date, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await workoutRepo.finishSession(tx, userId, sessionId, endedAt)
    const [session] = await tx.query<{ date: string }>('SELECT date FROM workout_sessions WHERE id = ? AND deleted_at IS NULL', [sessionId])
    const [count] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM set_logs WHERE session_id = ? AND deleted_at IS NULL AND kind <> 'warmup'",
      [sessionId],
    )
    if (!session || Number(count?.n ?? 0) === 0) return
    await adherenceRepo.mark(tx, userId, { date: session.date, targetType: 'workout', targetKey: WORKOUT_KEY, status: 'done' }, now)
  })
}

/**
 * Saves the day's check-in (dailyCheckinRepo.upsert, same `expected` guard) and marks the check-in done; cardio
 * answered "Sim" also marks cardio done. "Não" leaves the cardio mark alone (it may hold a reason given on Hoje).
 */
export async function saveCheckinAndMark(
  db: LocalDb,
  userId: string,
  date: string,
  fields: DailyCheckinFields,
  now: Date,
  options: { expected?: string | null } = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    const stamp = await dailyCheckinRepo.upsert(tx, userId, date, fields, now, options)
    await adherenceRepo.mark(tx, userId, { date, targetType: 'checkin', targetKey: CHECKIN_KEY, status: 'done' }, now)
    if (fields.cardioDone === true) {
      await adherenceRepo.mark(tx, userId, { date, targetType: 'cardio', targetKey: CARDIO_KEY, status: 'done' }, now)
    }
    return stamp
  })
}

export interface CardioMark {
  /** Null clears the mark. */
  status: AdherenceStatus | null
  reason?: AdherenceReason | null
  note?: string | null
}

/**
 * Marks (or clears) cardio on a day and mirrors it on that day's check-in when there is one: done → "Sim", missed →
 * "Não", cleared → not answered; partial leaves the check-in as it is. Without a check-in nothing else is written: a
 * check-in needs the whole form, so the mark alone carries it until the form is saved.
 */
export async function setCardio(db: LocalDb, userId: string, date: string, mark: CardioMark, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const target = { date, targetType: 'cardio' as const, targetKey: CARDIO_KEY }
    if (mark.status === null) await adherenceRepo.clear(tx, userId, target, now)
    else await adherenceRepo.mark(tx, userId, { ...target, status: mark.status, reason: mark.reason, note: mark.note }, now)

    const checkin = await dailyCheckinRepo.get(tx, date)
    if (!checkin || mark.status === 'partial') return
    const cardioDone = mark.status === 'done' ? true : mark.status === 'missed' ? false : null
    if (checkin.cardioDone === cardioDone) return
    const fields: DailyCheckinFields = { ...checkin, cardioDone, cardioMinutes: cardioDone ? checkin.cardioMinutes : null }
    await dailyCheckinRepo.upsert(tx, userId, date, fields, now)
  })
}
