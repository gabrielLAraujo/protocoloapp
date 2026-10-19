import { describe, expect, it, vi } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { finishSessionAndMark, saveCheckinAndMark, setCardio } from './adherenceLinks'
import { adherenceRepo } from './adherenceRepo'
import { dailyCheckinRepo, StaleCheckinError, type DailyCheckinFields } from './dailyCheckinRepo'
import { outbox } from './outbox'
import { workoutRepo } from './workoutRepo'

const DAY = '2026-10-19'
const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const PLAN = '7d1f2a10-0000-5000-8000-0000000000c1'
const EXERCISE = '7d1f2a10-0000-5000-8000-0000000000e1'

const fields: DailyCheckinFields = {
  sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 4, anxiety: 2, waterL: 3, weightKg: null, note: 'Teste',
  cardioDone: null, cardioMinutes: null,
}

const marks = async (db: Awaited<ReturnType<typeof newLocalDb>>) =>
  (await adherenceRepo.between(db, DAY, DAY)).map((l) => [l.targetType, l.status])

describe('finishSessionAndMark', () => {
  it('marks the workout of the session day done when it has a working set', async () => {
    const db = await newLocalDb()
    const id = await workoutRepo.startSession(db, USER_A, { date: DAY, planVersionId: PLAN, dayKey: 'a' }, T0)
    await workoutRepo.logSet(db, USER_A, { sessionId: id, exerciseId: EXERCISE, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal' }, later(60_000))

    await finishSessionAndMark(db, USER_A, id, later(120_000), later(130_000))

    expect((await workoutRepo.sessionsBetween(db, DAY, DAY))[0]!.endedAt).toBe(later(120_000).toISOString())
    expect(await marks(db)).toEqual([['workout', 'done']])
    const queued = await outbox.due(db, later(10_000_000), 500)
    expect(queued.map((e) => e.entity)).toEqual(['workout_session', 'set_log', 'workout_session', 'adherence_log'])
  })

  it('a session with only warm-up sets is not a workout done', async () => {
    const db = await newLocalDb()
    const id = await workoutRepo.startSession(db, USER_A, { date: DAY, planVersionId: PLAN, dayKey: 'a' }, T0)
    await workoutRepo.logSet(db, USER_A, { sessionId: id, exerciseId: EXERCISE, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 20, reps: 10, kind: 'warmup' }, later(60_000))

    await finishSessionAndMark(db, USER_A, id, later(120_000), later(120_000))

    expect(await marks(db)).toEqual([])
  })

  it('a failing mark rolls the finish back too', async () => {
    const db = await newLocalDb()
    const id = await workoutRepo.startSession(db, USER_A, { date: DAY, planVersionId: PLAN, dayKey: 'a' }, T0)
    await workoutRepo.logSet(db, USER_A, { sessionId: id, exerciseId: EXERCISE, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal' }, later(60_000))
    const spy = vi.spyOn(adherenceRepo, 'mark').mockRejectedValueOnce(new Error('disk'))

    await expect(finishSessionAndMark(db, USER_A, id, later(120_000), later(120_000))).rejects.toThrow('disk')

    spy.mockRestore()
    expect(await workoutRepo.openSession(db)).not.toBeNull()
  })
})

describe('saveCheckinAndMark', () => {
  it('saves the check-in and marks both check-in parts done; cardio "Sim" marks cardio done', async () => {
    const db = await newLocalDb()

    await saveCheckinAndMark(db, USER_A, DAY, { ...fields, cardioDone: true, cardioMinutes: 30 }, T0)

    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true, cardioMinutes: 30 })
    expect((await adherenceRepo.between(db, DAY, DAY)).map((l) => [l.targetType, l.targetKey, l.status])).toEqual([
      ['cardio', 'cardio', 'done'],
      ['checkin', 'checkin_evening', 'done'],
      ['checkin', 'checkin_morning', 'done'],
    ])
  })

  it('cardio "Sim" then "Não" leaves cardio missed (no reason); "Não" alone marks it missed', async () => {
    const db = await newLocalDb()
    await saveCheckinAndMark(db, USER_A, DAY, { ...fields, cardioDone: true, cardioMinutes: 30 }, T0)
    await saveCheckinAndMark(db, USER_A, DAY, { ...fields, cardioDone: false }, later(1000))
    expect(await adherenceRepo.between(db, DAY, DAY)).toMatchObject([
      { targetType: 'cardio', status: 'missed', reason: null },
      { targetType: 'checkin', status: 'done' },
      { targetType: 'checkin', status: 'done' },
    ])

    const other = await newLocalDb()
    await saveCheckinAndMark(other, USER_A, DAY, { ...fields, cardioDone: false }, T0)
    expect(await marks(other)).toEqual([['cardio', 'missed'], ['checkin', 'done'], ['checkin', 'done']])
  })

  it('cardio "Não" keeps a partial cardio mark given on Hoje', async () => {
    const db = await newLocalDb()
    await adherenceRepo.mark(db, USER_A, { date: DAY, targetType: 'cardio', targetKey: 'cardio', status: 'partial', reason: 'felt_sick' }, T0)
    await saveCheckinAndMark(db, USER_A, DAY, { ...fields, cardioDone: false }, later(1000))
    expect(await adherenceRepo.between(db, DAY, DAY)).toMatchObject([{ targetType: 'cardio', status: 'partial', reason: 'felt_sick' }, { targetType: 'checkin' }, { targetType: 'checkin' }])
  })

  it('cardio null (not answered) leaves the cardio mark alone', async () => {
    const db = await newLocalDb()
    await saveCheckinAndMark(db, USER_A, DAY, fields, T0)
    expect(await marks(db)).toEqual([['checkin', 'done'], ['checkin', 'done']])
  })

  it('cardio "Não" keeps a missed cardio mark with its reason given on Hoje', async () => {
    const db = await newLocalDb()
    await adherenceRepo.mark(db, USER_A, { date: DAY, targetType: 'cardio', targetKey: 'cardio', status: 'missed', reason: 'no_time' }, T0)

    await saveCheckinAndMark(db, USER_A, DAY, { ...fields, cardioDone: false }, later(1000))

    expect(await adherenceRepo.between(db, DAY, DAY)).toMatchObject([
      { targetType: 'cardio', status: 'missed', reason: 'no_time' },
      { targetType: 'checkin', status: 'done' },
      { targetType: 'checkin', status: 'done' },
    ])
  })

  it('a stale check-in writes neither the row nor the mark', async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.upsert(db, USER_A, DAY, fields, T0)

    await expect(saveCheckinAndMark(db, USER_A, DAY, fields, later(1000), { expected: null })).rejects.toBeInstanceOf(StaleCheckinError)

    expect(await marks(db)).toEqual([])
  })
})

describe('setCardio', () => {
  it('without a check-in only the mark is written', async () => {
    const db = await newLocalDb()

    await setCardio(db, USER_A, DAY, { status: 'done' }, T0)

    expect(await marks(db)).toEqual([['cardio', 'done']])
    expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
  })

  it("mirrors done / missed / cleared on the day's check-in, keeping its other answers; partial leaves it", async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.upsert(db, USER_A, DAY, fields, T0)

    await setCardio(db, USER_A, DAY, { status: 'done' }, later(1000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true, cardioMinutes: null, note: 'Teste', sleepQuality: 4 })

    await setCardio(db, USER_A, DAY, { status: 'partial', reason: 'no_time' }, later(2000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true })

    await setCardio(db, USER_A, DAY, { status: 'missed', reason: 'felt_sick' }, later(3000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: false })
    expect(await adherenceRepo.between(db, DAY, DAY)).toMatchObject([{ status: 'missed', reason: 'felt_sick' }])

    await setCardio(db, USER_A, DAY, { status: null }, later(4000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: null })
    expect(await marks(db)).toEqual([])
  })
})
