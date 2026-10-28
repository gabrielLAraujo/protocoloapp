import { CARDIO_KEY, CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY, WORKOUT_KEY } from '../domain/dayPlan'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from './adherenceRepo'
import { dailyCheckinRepo, type EveningFields, type MorningFields } from './dailyCheckinRepo'
import type { LocalDb } from './localDb'
import { workoutRepo } from './workoutRepo'

/**
 * Writes that keep `adherence_log` in step with the screens that already record the same fact (a finished workout, each
 * part of the check-in, cardio on the check-in). The server skips a reminder only when an adherence log exists for the target and
 * day, so these marks are what silence the "Hora do treino" / "Check-in da manhã" / "Check-in da noite" / "Hora do
 * cardio" pushes. Each runs in one transaction: the row, the mark and their outbox entries are committed together or not at all.
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
 * "Salvar treino" of a workout logged afterwards or corrected from the history: ends an open session at its last set
 * (or its start without sets), then keeps the day's workout mark in step with the sets. With a working set the workout of
 * its date is done; without one, a "done" mark is cleared unless another finished session of that date has working sets.
 */
export async function saveLoggedSession(db: LocalDb, userId: string, sessionId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx.query<{ date: string; started_at: string; ended_at: string | null }>(
      'SELECT date, started_at, ended_at FROM workout_sessions WHERE id = ? AND deleted_at IS NULL',
      [sessionId],
    )
    if (!session) throw new Error('Session not found.')
    if (session.ended_at === null) {
      const [last] = await tx.query<{ at: string | null }>('SELECT MAX(completed_at) AS at FROM set_logs WHERE session_id = ? AND deleted_at IS NULL', [
        sessionId,
      ])
      await workoutRepo.finishSession(tx, userId, sessionId, new Date(last?.at ?? session.started_at))
    }
    await markWorkoutOf(tx, userId, session.date, now)
  })
}

/** With a working set in a finished session of `date` its workout is done; without one, a "done" mark is cleared. */
async function markWorkoutOf(tx: LocalDb, userId: string, date: string, now: Date): Promise<void> {
  const target = { date, targetType: 'workout' as const, targetKey: WORKOUT_KEY }
  if ((await workoutRepo.workedOutDates(tx, date, date)).length > 0) {
    await adherenceRepo.mark(tx, userId, { ...target, status: 'done' }, now)
    return
  }
  const [mark] = (await adherenceRepo.between(tx, date, date)).filter((l) => l.targetType === 'workout' && l.targetKey === WORKOUT_KEY)
  if (mark?.status === 'done') await adherenceRepo.clear(tx, userId, target, now)
}

/**
 * Deletes a session from the app with its sets and exercise changes ("Excluir do app", "Manter só um"): each set goes
 * through the normal set delete (its sub-sets first), each live change through the normal change undo, then the session,
 * all queued in the outbox; then the day's workout mark follows what is
 * left on that date. No-op when the session is already gone.
 */
export async function deleteSessionAndMark(db: LocalDb, userId: string, sessionId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await workoutRepo.sessionById(tx, sessionId)
    if (!session) return
    const sets = await workoutRepo.setsForSession(tx, sessionId)
    for (const set of sets.filter((s) => s.parentSetId === null)) await workoutRepo.deleteSet(tx, userId, set.id, now)
    // A sub-set whose parent was already gone (should not happen) goes on its own.
    for (const set of await workoutRepo.setsForSession(tx, sessionId)) await workoutRepo.deleteSet(tx, userId, set.id, now)
    for (const change of await workoutRepo.changesForSession(tx, sessionId)) await workoutRepo.removeChange(tx, userId, change.id, now)
    await workoutRepo.deleteSession(tx, userId, sessionId, now)
    await markWorkoutOf(tx, userId, session.date, now)
  })
}

export interface CardioMark {
  /** Null clears the mark. */
  status: AdherenceStatus | null
  reason?: AdherenceReason | null
  note?: string | null
  /** Minutes of a done cardio ("Quantos minutos?"); undefined keeps the minutes already on the check-in. */
  minutes?: number | null
}

/**
 * Marks (or clears) cardio on a day and mirrors it on that day's check-in (dailyCheckinRepo.setCardio, `parts:
 * ["cardio"]`): done → cardio done (with the minutes), missed → not done, cleared → not answered; partial leaves the
 * check-in as it is. Done or missed create the day's row when there is none (both parts null); clearing a day without a
 * row writes no row.
 */
export async function setCardio(db: LocalDb, userId: string, date: string, mark: CardioMark, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const target = { date, targetType: 'cardio' as const, targetKey: CARDIO_KEY }
    if (mark.status === null) await adherenceRepo.clear(tx, userId, target, now)
    else await adherenceRepo.mark(tx, userId, { ...target, status: mark.status, reason: mark.reason, note: mark.note }, now)

    if (mark.status === 'partial') return
    const checkin = await dailyCheckinRepo.get(tx, date)
    if (!checkin && mark.status === null) return
    const done = mark.status === 'done' ? true : mark.status === 'missed' ? false : null
    const kept = checkin?.cardioDone === true ? checkin.cardioMinutes : null
    const minutes = done === true ? (mark.minutes === undefined ? kept : mark.minutes) : null
    if (checkin && checkin.cardioDone === done && checkin.cardioMinutes === minutes) return
    await dailyCheckinRepo.setCardio(tx, userId, date, { done, minutes }, now)
  })
}

/** Saves the day's morning check-in and marks the "Check-in da manhã" target done, in one transaction. */
export async function saveMorningAndMark(db: LocalDb, userId: string, date: string, fields: MorningFields, now: Date): Promise<string> {
  return db.transaction(async (tx) => {
    const stamp = await dailyCheckinRepo.saveMorning(tx, userId, date, fields, now)
    await adherenceRepo.mark(tx, userId, { date, targetType: 'checkin', targetKey: CHECKIN_MORNING_KEY, status: 'done' }, now)
    return stamp
  })
}

/** Saves the day's evening check-in and marks the "Check-in da noite" target done, in one transaction. */
export async function saveEveningAndMark(db: LocalDb, userId: string, date: string, fields: EveningFields, now: Date): Promise<string> {
  return db.transaction(async (tx) => {
    const stamp = await dailyCheckinRepo.saveEvening(tx, userId, date, fields, now)
    await adherenceRepo.mark(tx, userId, { date, targetType: 'checkin', targetKey: CHECKIN_EVENING_KEY, status: 'done' }, now)
    return stamp
  })
}
