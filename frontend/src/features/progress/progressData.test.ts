import { describe, expect, it } from 'vitest'
import type { components } from '../../api/schema'
import { adherenceRepo } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { addDays, diffDays } from '../../domain/calendarDate'
import type { ProtocolDocument, WorkoutDocument } from '../../domain/planDocuments'
import { newLocalDb, USER_A } from '../../test/localDb'
import { HISTORY_DAYS, loadProgress } from './progressData'

type SyncRecord = components['schemas']['SyncRecord']

// Fictitious plans. 2026-10-19 is a Monday; today is Thursday 2026-10-22, 20:00 on the device.
const TODAY = '2026-10-22'
const NOW = new Date(2026, 9, 22, 20, 0)
const T = new Date('2026-10-19T12:00:00.000Z')
const PROTOCOL_ID = '7d1f2a10-0000-5000-8000-0000000000c1'
const WORKOUT_ID = '7d1f2a10-0000-5000-8000-0000000000c2'
const EXERCISE_ID = '7d1f2a10-0000-5000-8000-0000000000c3'

const record = (id: string, kind: string, document: unknown, activatedAt: string): SyncRecord => ({
  entity: 'plan_version',
  id,
  version: 1,
  payload: { kind, status: 'active', document, activated_at: activatedAt, low_confidence: [] },
  deletedAt: null,
  clientUpdatedAt: activatedAt,
})

const protocol: ProtocolDocument = {
  updateDate: '2026-11-15',
  meals: [{ key: '1', label: 'Café', items: [] }],
  items: [],
  guidelines: [{ kind: 'water_min_l', value: 2 }],
}

const workout: WorkoutDocument = {
  rotation: { type: 'fixed_weekdays', map: { mon: 'a', tue: 'off', wed: 'a', thu: 'off', fri: 'a', sat: 'off', sun: 'off' } },
  days: [{ key: 'a', name: 'Treino A', exercises: [] }],
}

async function seedDay(db: LocalDb, date: string, opts: { meal?: boolean; checkin?: boolean; workout?: boolean } = {}) {
  if (opts.meal !== false) await adherenceRepo.mark(db, USER_A, { date, targetType: 'meal', targetKey: '1', status: 'done' }, T)
  if (opts.checkin !== false) {
    await dailyCheckinRepo.saveMorning(db, USER_A, date, { sleepQuality: 4, energyWake: 4, bowel: 'normal', weightKg: null }, T)
    await dailyCheckinRepo.saveEvening(db, USER_A, date, { energyDay: 4, anxiety: 2, waterL: 2.5, note: null }, T)
  }
  if (opts.workout) {
    const session = await workoutRepo.startSession(db, USER_A, { date, planVersionId: WORKOUT_ID, dayKey: 'a' }, T)
    await workoutRepo.logSet(db, USER_A, { sessionId: session, exerciseId: EXERCISE_ID, plannedExerciseKey: 'x', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal' }, T)
    await workoutRepo.finishSession(db, USER_A, session, T)
  }
}

describe('loadProgress', () => {
  it('builds the history from the first activation and computes score, streak, week goals and medals', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', protocol, '2026-10-19T12:00:00.000Z'))
    await planVersionSync.applyRemote(db, record(WORKOUT_ID, 'workout', workout, '2026-10-19T12:00:00.000Z'))
    await seedDay(db, '2026-10-19', { workout: true }) // meal, workout, 2 check-ins: 4/4
    await seedDay(db, '2026-10-20') // rest day: 3/3
    await seedDay(db, '2026-10-21') // training day without a session: 3/4 = 75 %
    await seedDay(db, TODAY) // rest day: 3/3

    const p = await loadProgress(db, TODAY, NOW)

    expect(p.history.map((d) => [d.date, d.score.done, d.score.planned])).toEqual([
      ['2026-10-19', 4, 4],
      ['2026-10-20', 3, 3],
      ['2026-10-21', 3, 4],
      [TODAY, 3, 3],
    ])
    expect(p.todayScore).toEqual({ done: 3, partial: 0, planned: 3, ratio: 1 })
    // Wednesday below 90 % reset it; today is on target, so it joins.
    expect(p.streak).toEqual({ current: 1, best: 2 })
    expect(p.cycleBest).toBe(2)
    expect(p.cycle).toMatchObject({ activatedOn: '2026-10-19', end: '2026-11-15' })

    expect(p.week.map((d) => [d.date, d.when])).toEqual([
      ['2026-10-19', 'past'], ['2026-10-20', 'past'], ['2026-10-21', 'past'], [TODAY, 'today'],
      ['2026-10-23', 'future'], ['2026-10-24', 'future'], ['2026-10-25', 'future'],
    ])
    expect(p.weekGoals.map((g) => [g.key, g.progress, g.target, g.done])).toEqual([
      ['diet', 100, 90, true],
      ['workouts', 1, 3, false], // Mon done, Wed missed, Fri ahead
      ['water', 4, 5, false],
      ['checkins', 4, 7, false],
    ])
    expect(p.weeks).toEqual([])
    const medal = (key: string) => p.medals.find((m) => m.key === key)
    expect(medal('streak_7')).toMatchObject({ earnedOn: null, progress: { value: 1, target: 7 } })
    expect(medal('diet_100_7')).toMatchObject({ earnedOn: null, progress: { value: 4, target: 7 } })
    // The cycle runs to 11-15: Mon/Wed/Fri from 10-19 = 12 planned, 1 done.
    expect(medal('all_workouts_cycle')).toMatchObject({ earnedOn: null, progress: { value: 1, target: 12 } })
  })

  it('today counts only what is due or marked, by the given clock', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', protocol, '2026-10-19T12:00:00.000Z'))
    // No times set and nothing marked today: nothing counts yet, and the streak is not broken by it.
    await seedDay(db, '2026-10-21')
    const p = await loadProgress(db, TODAY, NOW)
    expect(p.todayScore).toEqual({ done: 0, partial: 0, planned: 0, ratio: null })
    expect(p.streak.current).toBe(1)
  })

  it('keeps the whole history from the first activation, beyond 90 days', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', { ...protocol, updateDate: undefined }, '2026-01-05T12:00:00.000Z'))
    const p = await loadProgress(db, TODAY, NOW)
    expect(p.history[0]!.date).toBe('2026-01-05')
    expect(p.history).toHaveLength(diffDays('2026-01-05', TODAY) + 1)
    expect(p.history.at(-1)!.date).toBe(TODAY)
    expect(p.weeks.length).toBeGreaterThan(30)
    expect(p.weeks.every((w) => !w.perfect)).toBe(true)
  })

  it(`goes back at most ${HISTORY_DAYS} days (three years)`, async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', { ...protocol, updateDate: undefined }, '2020-01-06T12:00:00.000Z'))
    const p = await loadProgress(db, TODAY, NOW)
    expect(p.history).toHaveLength(HISTORY_DAYS)
    expect(p.history[0]!.date).toBe(addDays(TODAY, -(HISTORY_DAYS - 1)))
  })

  describe('all workouts of a cycle that began more than 90 days ago', () => {
    // Cycle 1: 06-01 → 07-31, workouts on Mondays (9 of them); cycle 2 from 08-01 is the one in force.
    const MONDAYS = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
    const mondays: WorkoutDocument = { rotation: { type: 'fixed_weekdays', map: { mon: 'a' } }, days: [{ key: 'a', name: 'Treino A', exercises: [] }] }

    async function setup(done: string[]) {
      const db = await newLocalDb()
      await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', { ...protocol, updateDate: '2026-07-31' }, '2026-06-01T12:00:00.000Z'))
      await planVersionSync.applyRemote(db, record('7d1f2a10-0000-5000-8000-0000000000c4', 'protocol', protocol, '2026-08-01T12:00:00.000Z'))
      await planVersionSync.applyRemote(db, record(WORKOUT_ID, 'workout', mondays, '2026-06-01T12:00:00.000Z'))
      for (const date of done) await seedDay(db, date, { meal: false, checkin: false, workout: true })
      return loadProgress(db, TODAY, NOW)
    }

    it('one missed workout: not earned', async () => {
      const p = await setup(MONDAYS.filter((d) => d !== '2026-07-13'))
      expect(p.history[0]!.date).toBe('2026-06-01')
      expect(p.medals.find((m) => m.key === 'all_workouts_cycle')).toMatchObject({ earnedOn: null, count: 0 })
    })

    it('all done: earned on the last day of the cycle', async () => {
      const p = await setup(MONDAYS)
      expect(p.medals.find((m) => m.key === 'all_workouts_cycle')).toMatchObject({ earnedOn: '2026-07-31', count: 1 })
    })
  })

  it('cardio done on the check-in without a mark counts for the day and the week', async () => {
    const db = await newLocalDb()
    await planVersionSync.applyRemote(db, record(PROTOCOL_ID, 'protocol', { ...protocol, cardio: { daily: true } }, '2026-10-19T12:00:00.000Z'))
    await dailyCheckinRepo.setCardio(db, USER_A, '2026-10-20', { done: true, minutes: 30 }, T)
    const p = await loadProgress(db, TODAY, NOW)
    expect(p.history.find((d) => d.date === '2026-10-20')).toMatchObject({ cardio: { planned: true, done: true }, score: { done: 1, planned: 4 } })
    expect(p.weekGoals.find((g) => g.key === 'cardio')).toMatchObject({ progress: 1, target: 7 })
  })

  it('without any plan: only today, nothing planned', async () => {
    const db = await newLocalDb()
    const p = await loadProgress(db, TODAY, NOW)
    expect(p.history.map((d) => d.date)).toEqual([TODAY])
    expect(p.todayScore.planned).toBe(0)
    expect(p.streak).toEqual({ current: 0, best: 0 })
    expect(p.cycle).toBeNull()
    // The history starts today (Thursday): the check-in goal covers Thursday to Sunday.
    expect(p.weekGoals).toMatchObject([{ key: 'checkins', progress: 0, target: 4 }])
  })
})
