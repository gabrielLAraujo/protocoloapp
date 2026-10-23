import { describe, expect, it, vi } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { finishSessionAndMark, saveLoggedSession, saveEveningAndMark, saveMorningAndMark, setCardio } from './adherenceLinks'
import { adherenceRepo } from './adherenceRepo'
import { checkinParts, dailyCheckinRepo, type EveningFields, type MorningFields } from './dailyCheckinRepo'
import { outbox } from './outbox'
import { workoutRepo } from './workoutRepo'

const DAY = '2026-10-19'
const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const PLAN = '7d1f2a10-0000-5000-8000-0000000000c1'
const EXERCISE = '7d1f2a10-0000-5000-8000-0000000000e1'

const morningFields: MorningFields = { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }
const eveningFields: EveningFields = { energyDay: 4, anxiety: 2, waterL: 3, note: 'Teste' }

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

describe('setCardio', () => {
  it('without a check-in, done or missed creates a row with both parts null; clearing writes no row', async () => {
    const db = await newLocalDb()

    await setCardio(db, USER_A, DAY, { status: null }, T0)
    expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()

    await setCardio(db, USER_A, DAY, { status: 'done', minutes: 35 }, later(1000))
    expect(await marks(db)).toEqual([['cardio', 'done']])
    const row = await dailyCheckinRepo.get(db, DAY)
    expect(row).toMatchObject({ cardioDone: true, cardioMinutes: 35, sleepQuality: null, energyDay: null })
    expect(checkinParts(row!)).toEqual({ morning: false, evening: false })
    const checkinChanges = (await outbox.due(db, T0, 500)).filter((e) => e.entity === 'daily_checkin')
    expect(checkinChanges.map((e) => JSON.parse(e.payload!).parts)).toEqual([['cardio']])
  })

  it('done without minutes keeps the minutes already saved; the same answer writes nothing new', async () => {
    const db = await newLocalDb()
    await setCardio(db, USER_A, DAY, { status: 'done', minutes: 35 }, T0)

    await setCardio(db, USER_A, DAY, { status: 'done' }, later(1000))

    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true, cardioMinutes: 35 })
    expect((await outbox.due(db, T0, 500)).filter((e) => e.entity === 'daily_checkin')).toHaveLength(1)
  })

  it("mirrors done / missed / cleared on the day's check-in, keeping its other answers; partial leaves it", async () => {
    const db = await newLocalDb()
    await dailyCheckinRepo.saveMorning(db, USER_A, DAY, morningFields, T0)
    await dailyCheckinRepo.saveEvening(db, USER_A, DAY, eveningFields, T0)

    await setCardio(db, USER_A, DAY, { status: 'done' }, later(1000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true, cardioMinutes: null, note: 'Teste', sleepQuality: 4 })

    await setCardio(db, USER_A, DAY, { status: 'partial', reason: 'no_time' }, later(2000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: true })

    await setCardio(db, USER_A, DAY, { status: 'missed', reason: 'felt_sick' }, later(3000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: false })
    expect(await adherenceRepo.between(db, DAY, DAY)).toMatchObject([{ status: 'missed', reason: 'felt_sick' }])

    await setCardio(db, USER_A, DAY, { status: null }, later(4000))
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({ cardioDone: null, note: 'Teste', sleepQuality: 4 })
    expect(await marks(db)).toEqual([])
    const cardioChanges = (await outbox.due(db, T0, 500)).filter((e) => e.entity === 'daily_checkin').slice(2)
    expect(cardioChanges.map((e) => [JSON.parse(e.payload!).parts, JSON.parse(e.payload!).cardio_done])).toEqual([
      [['cardio'], true],
      [['cardio'], false],
      [['cardio'], null],
    ])
  })
})

describe('saveMorningAndMark / saveEveningAndMark', () => {
  it('each part marks only its own target done, and the second keeps the first', async () => {
    const db = await newLocalDb()

    await saveMorningAndMark(db, USER_A, DAY, { sleepQuality: 4, energyWake: 3, bowel: 'normal', weightKg: null }, T0)
    expect((await adherenceRepo.between(db, DAY, DAY)).map((l) => l.targetKey)).toEqual(['checkin_morning'])

    await saveEveningAndMark(db, USER_A, DAY, { energyDay: 4, anxiety: 2, waterL: 3, note: null }, later(1000))
    const logs = await adherenceRepo.between(db, DAY, DAY)
    expect(logs.map((l) => [l.targetKey, l.status]).sort()).toEqual([['checkin_evening', 'done'], ['checkin_morning', 'done']])
    expect(checkinParts((await dailyCheckinRepo.get(db, DAY))!)).toEqual({ morning: true, evening: true })
  })

  it('a failing mark rolls the part back too', async () => {
    const db = await newLocalDb()
    vi.spyOn(adherenceRepo, 'mark').mockRejectedValueOnce(new Error('disk full'))

    await expect(saveEveningAndMark(db, USER_A, DAY, { energyDay: 4, anxiety: 2, waterL: 3, note: null }, T0)).rejects.toThrow('disk full')

    expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
    expect(await outbox.pendingCount(db)).toBe(0)
  })
})

describe('saveLoggedSession', () => {
  const PAST = '2026-10-15'
  const NOON = new Date(2026, 9, 15, 12)
  const NOW = new Date('2026-10-20T15:00:00.000Z')

  it('keeps the start, the set times and the end on the logged day, and marks that day done', async () => {
    const db = await newLocalDb()
    const id = await workoutRepo.startSession(db, USER_A, { date: PAST, planVersionId: PLAN, dayKey: 'a', startedAt: NOON }, NOW)
    const setId = await workoutRepo.logSet(
      db,
      USER_A,
      { sessionId: id, exerciseId: EXERCISE, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal', completedAt: new Date(NOON.getTime() + 1000) },
      NOW,
    )
    await workoutRepo.logSubSet(db, USER_A, { parentSetId: setId, kind: 'drop', ordinal: 1, weightKg: 40, reps: 8, completedAt: new Date(NOON.getTime() + 2000) }, NOW)

    await saveLoggedSession(db, USER_A, id, NOW)

    const [session] = await workoutRepo.sessionsBetween(db, PAST, PAST)
    expect(session).toMatchObject({ startedAt: NOON.toISOString(), endedAt: new Date(NOON.getTime() + 2000).toISOString(), clientUpdatedAt: expect.any(String) })
    expect((await workoutRepo.setsForSession(db, id)).map((s) => s.completedAt)).toEqual([
      new Date(NOON.getTime() + 1000).toISOString(),
      new Date(NOON.getTime() + 2000).toISOString(),
    ])
    expect((await adherenceRepo.between(db, PAST, PAST)).map((l) => [l.targetType, l.status])).toEqual([['workout', 'done']])
  })

  it('a session left without working sets clears the day\'s workout mark (unless another session counts)', async () => {
    const db = await newLocalDb()
    const id = await workoutRepo.startSession(db, USER_A, { date: PAST, planVersionId: PLAN, dayKey: 'a', startedAt: NOON }, NOW)
    const setId = await workoutRepo.logSet(db, USER_A, { sessionId: id, exerciseId: EXERCISE, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal' }, NOW)
    await saveLoggedSession(db, USER_A, id, NOW)
    await workoutRepo.deleteSet(db, USER_A, setId, later(10_000_000))

    await saveLoggedSession(db, USER_A, id, later(10_000_000))

    expect(await adherenceRepo.between(db, PAST, PAST)).toEqual([])
  })
})
