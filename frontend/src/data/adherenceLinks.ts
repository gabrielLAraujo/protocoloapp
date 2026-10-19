import { CARDIO_KEY, CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY, WORKOUT_KEY } from '../domain/dayPlan'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from './adherenceRepo'
import { dailyCheckinRepo, type DailyCheckinFields, type EveningFields, type MorningFields } from './dailyCheckinRepo'
import type { LocalDb } from './localDb'
import { workoutRepo } from './workoutRepo'

/**
 * Writes that keep `adherence_log` in step with the screens that already record the same fact (a finished workout, the
 * check-in, cardio in the check-in). The server skips a reminder only when an adherence log exists for the target and
 * day, so these marks are what silence the "Hora do treino" / "Check-in da manhã" / "Check-in da noite" / "Hora do cardio" pushes. Each runs
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
 * Saves the day's check-in (dailyCheckinRepo.upsert, same `expected` guard) and marks both check-in parts (morning and
 * evening) done, since this form holds both; cardio
 * answered "Sim" marks cardio done; "Não" marks it missed unless it is already missed or partial (keeping the reason
 * given on Hoje).
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
    for (const targetKey of [CHECKIN_MORNING_KEY, CHECKIN_EVENING_KEY]) {
      await adherenceRepo.mark(tx, userId, { date, targetType: 'checkin', targetKey, status: 'done' }, now)
    }
    const cardio = { date, targetType: 'cardio' as const, targetKey: CARDIO_KEY }
    if (fields.cardioDone === true) {
      await adherenceRepo.mark(tx, userId, { ...cardio, status: 'done' }, now)
    } else if (fields.cardioDone === false) {
      // "Não" overrides a done mark (or fills a missing one), but keeps a missed/partial mark with its reason from Hoje.
      const current = (await adherenceRepo.between(tx, date, date)).find((l) => l.targetType === 'cardio' && l.targetKey === CARDIO_KEY)
      if (!current || current.status === 'done') await adherenceRepo.mark(tx, userId, { ...cardio, status: 'missed' }, now)
    }
    return stamp
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
