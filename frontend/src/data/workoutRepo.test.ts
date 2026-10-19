import { describe, expect, it } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { outbox } from './outbox'
import { setLogSync, workoutRepo, workoutSessionSync } from './workoutRepo'

const T0 = new Date('2026-10-18T12:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
const PLAN = '7d1f2a10-0000-5000-8000-0000000000a1'
const EX = '7d1f2a10-0000-5000-8000-0000000000e1'

const start = (db: Awaited<ReturnType<typeof newLocalDb>>) =>
  workoutRepo.startSession(db, USER_A, { date: '2026-10-18', planVersionId: PLAN, dayKey: 'a' }, T0)

const setInput = (sessionId: string, setIndex: number) => ({
  sessionId,
  exerciseId: EX,
  plannedExerciseKey: 'supino',
  setIndex,
  weightKg: 80,
  reps: 8,
  kind: 'normal' as const,
})

describe('workoutRepo', () => {
  it('a session with two sets queues three entries, the session first', async () => {
    const db = await newLocalDb()

    const sessionId = await start(db)
    const s1 = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
    const s2 = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 1), at(8))

    const entries = await outbox.due(db, at(10), 500)
    expect(entries.map((e) => [e.entity, e.id])).toEqual([
      ['workout_session', sessionId],
      ['set_log', s1],
      ['set_log', s2],
    ])
    expect(JSON.parse(entries[0]!.payload!)).toEqual({
      date: '2026-10-18',
      plan_version_id: PLAN,
      workout_day_key: 'a',
      started_at: T0.toISOString(),
      ended_at: null,
      note: null,
    })
    expect(JSON.parse(entries[1]!.payload!)).toEqual({
      session_id: sessionId,
      exercise_id: EX,
      planned_exercise_key: 'supino',
      set_index: 0,
      weight_kg: 80,
      reps: 8,
      kind: 'normal',
      parent_set_id: null,
      completed_at: at(5).toISOString(),
    })
    expect((await workoutRepo.setsForSession(db, sessionId)).map((s) => s.id)).toEqual([s1, s2])
  })

  it('openSession finds the session without ended_at until it is finished', async () => {
    const db = await newLocalDb()
    expect(await workoutRepo.openSession(db)).toBeNull()

    const sessionId = await start(db)
    expect(await workoutRepo.openSession(db)).toMatchObject({ id: sessionId, endedAt: null, dayKey: 'a', planVersionId: PLAN })

    await workoutRepo.finishSession(db, USER_A, sessionId, at(50))
    expect(await workoutRepo.openSession(db)).toBeNull()
    const [session] = await workoutRepo.sessionsBetween(db, '2026-10-18', '2026-10-18')
    expect(session).toMatchObject({ id: sessionId, endedAt: at(50).toISOString() })
    // The finished session goes after its sets in the queue, as a new entry.
    expect((await outbox.due(db, at(60), 500)).map((e) => e.entity)).toEqual(['workout_session', 'workout_session'])
  })

  it('editing a set queues a new entry after; deleting hides it and queues the delete', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)
    const setId = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))

    await workoutRepo.updateSet(db, USER_A, setId, { weightKg: 82.5, reps: 6 }, at(6))
    expect(await workoutRepo.setsForSession(db, sessionId)).toMatchObject([{ weightKg: 82.5, reps: 6, kind: 'normal' }])

    await workoutRepo.deleteSet(db, USER_A, setId, at(7))
    expect(await workoutRepo.setsForSession(db, sessionId)).toEqual([])
    const entries = await outbox.due(db, at(10), 500)
    expect(entries.map((e) => [e.entity, e.op])).toEqual([
      ['workout_session', 'upsert'],
      ['set_log', 'upsert'],
      ['set_log', 'upsert'],
      ['set_log', 'delete'],
    ])
    expect(JSON.parse(entries[2]!.payload!)).toMatchObject({ weight_kg: 82.5, reps: 6 })
  })

  it('setsForExercise returns the latest sets, newest first, limited', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)
    for (const [i, minutes] of [5, 8, 11].entries()) await workoutRepo.logSet(db, USER_A, setInput(sessionId, i), at(minutes))

    const sets = await workoutRepo.setsForExercise(db, EX, 2)

    expect(sets.map((s) => s.setIndex)).toEqual([2, 1])
  })

  it('records a swap and a skip', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)

    await workoutRepo.recordChange(db, USER_A, { sessionId, plannedExerciseKey: 'supino', action: 'swapped', replacementExerciseId: EX, note: 'banco ocupado' }, at(2))
    await workoutRepo.recordChange(db, USER_A, { sessionId, plannedExerciseKey: 'crucifixo', action: 'skipped', replacementExerciseId: EX }, at(3))

    expect(await workoutRepo.changesForSession(db, sessionId)).toMatchObject([
      { plannedExerciseKey: 'supino', action: 'swapped', replacementExerciseId: EX, note: 'banco ocupado' },
      { plannedExerciseKey: 'crucifixo', action: 'skipped', replacementExerciseId: null, note: null },
    ])
  })

  it('a write that fails to queue leaves no row behind', async () => {
    const db = await newLocalDb()
    await db.execute('DROP TABLE outbox')

    await expect(start(db)).rejects.toThrow()

    expect(await db.query('SELECT * FROM workout_sessions')).toEqual([])
  })

  it('stores pulled sessions and sets', async () => {
    const db = await newLocalDb()
    const base = { deletedAt: null, clientUpdatedAt: '2026-10-18T12:00:00+00:00' }
    await workoutSessionSync.applyRemote(db, {
      ...base,
      entity: 'workout_session',
      id: 's1',
      version: 1,
      payload: { date: '2026-10-18', plan_version_id: PLAN, workout_day_key: 'b', started_at: '2026-10-18T11:00:00+00:00', ended_at: null, note: null },
    })
    await setLogSync.applyRemote(db, {
      ...base,
      entity: 'set_log',
      id: 'l1',
      version: 2,
      payload: { session_id: 's1', exercise_id: EX, planned_exercise_key: null, set_index: 0, weight_kg: 60.5, reps: 10, kind: 'warmup', parent_set_id: null, completed_at: '2026-10-18T11:05:00+00:00' },
    })

    expect(await workoutRepo.openSession(db)).toMatchObject({ id: 's1', dayKey: 'b', startedAt: '2026-10-18T11:00:00.000Z' })
    expect(await workoutRepo.setsForSession(db, 's1')).toMatchObject([{ id: 'l1', weightKg: 60.5, kind: 'warmup', plannedExerciseKey: null }])
  })

  it('removeChange soft-deletes the change and queues the delete; a second call does nothing', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)
    const id = await workoutRepo.recordChange(db, USER_A, { sessionId, plannedExerciseKey: 'supino', action: 'skipped' }, at(2))

    await workoutRepo.removeChange(db, USER_A, id, at(3))
    await workoutRepo.removeChange(db, USER_A, id, at(4))

    expect(await workoutRepo.changesForSession(db, sessionId)).toEqual([])
    const entries = await outbox.due(db, at(10), 500)
    expect(entries.map((e) => [e.entity, e.op])).toEqual([
      ['workout_session', 'upsert'],
      ['exercise_change', 'upsert'],
      ['exercise_change', 'delete'],
    ])
  })

  it('sessionSummaries aggregates set count and volume per session (warm-ups out of the volume), newest first, paged', async () => {
    const db = await newLocalDb()
    const old = await workoutRepo.startSession(db, USER_A, { date: '2026-10-10', planVersionId: PLAN, dayKey: 'a' }, at(-60 * 24 * 8))
    await workoutRepo.logSet(db, USER_A, setInput(old, 0), at(-60 * 24 * 8 + 5))
    const recent = await start(db)
    await workoutRepo.logSet(db, USER_A, setInput(recent, 0), at(5))
    await workoutRepo.logSet(db, USER_A, { ...setInput(recent, 1), kind: 'warmup' }, at(6))
    const gone = await workoutRepo.logSet(db, USER_A, setInput(recent, 2), at(7))
    await workoutRepo.deleteSet(db, USER_A, gone, at(8))
    await workoutRepo.startSession(db, USER_A, { date: '2026-10-12', planVersionId: PLAN, dayKey: 'b' }, at(-60 * 24 * 6))

    const all = await workoutRepo.sessionSummaries(db, 10, 0)
    expect(all.map((r) => [r.session.date, r.setCount, r.volume])).toEqual([
      ['2026-10-18', 2, 640],
      ['2026-10-12', 0, 0],
      ['2026-10-10', 1, 640],
    ])
    expect((await workoutRepo.sessionSummaries(db, 2, 0)).map((r) => r.session.date)).toEqual(['2026-10-18', '2026-10-12'])
    expect((await workoutRepo.sessionSummaries(db, 2, 2)).map((r) => r.session.date)).toEqual(['2026-10-10'])
  })

  it('sets of a soft-deleted session are left out of setsForExercise and exerciseIdsWithSets', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)
    await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
    expect(await workoutRepo.exerciseIdsWithSets(db)).toEqual([EX])

    await workoutSessionSync.applyRemote(db, {
      entity: 'workout_session',
      id: sessionId,
      version: 5,
      payload: null,
      deletedAt: '2026-10-18T13:00:00+00:00',
      clientUpdatedAt: '2030-01-01T00:00:00.000000+00:00',
    })

    expect(await workoutRepo.setsForExercise(db, EX, 10)).toEqual([])
    expect(await workoutRepo.exerciseIdsWithSets(db)).toEqual([])
  })
})
