import { describe, expect, it } from 'vitest'
import { newLocalDb, USER_A } from '../test/localDb'
import { seedChange, seedSession, seedSet } from '../test/workoutSeed'
import { outbox } from './outbox'
import { setLogSync, workoutRepo, workoutSessionSync } from './workoutRepo'

const T0 = new Date('2026-10-18T12:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
const PLAN = '7d1f2a10-0000-5000-8000-0000000000a1'
const EX = '7d1f2a10-0000-5000-8000-0000000000e1'

type Db = Awaited<ReturnType<typeof newLocalDb>>

const session = (db: Db, date = '2026-10-18', extra: { endedAt?: Date | null; dayKey?: string } = {}) =>
  seedSession(db, { date, planVersionId: PLAN, dayKey: extra.dayKey ?? 'a', startedAt: T0, endedAt: extra.endedAt })

const set = (db: Db, sessionId: string, setIndex: number, minutes: number, extra: { kind?: 'warmup' | 'drop' | 'rest_pause'; parentSetId?: string; weightKg?: number; reps?: number } = {}) =>
  seedSet(db, {
    sessionId,
    exerciseId: EX,
    plannedExerciseKey: 'supino',
    setIndex,
    weightKg: extra.weightKg ?? 80,
    reps: extra.reps ?? 8,
    kind: extra.kind ?? 'normal',
    parentSetId: extra.parentSetId ?? null,
    completedAt: at(minutes),
  })

describe('workoutRepo', () => {
  it('stores pulled sessions and sets without queueing anything', async () => {
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

    expect(await workoutRepo.sessionById(db, 's1')).toMatchObject({ id: 's1', dayKey: 'b', startedAt: '2026-10-18T11:00:00.000Z', endedAt: null })
    expect(await workoutRepo.setsForSession(db, 's1')).toMatchObject([{ id: 'l1', weightKg: 60.5, kind: 'warmup', plannedExerciseKey: null }])
    expect(await outbox.due(db, at(10), 500)).toEqual([])
  })

  it('setsForSession lists the sets in the order they were done', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    const s2 = await set(db, sessionId, 1, 8)
    const s1 = await set(db, sessionId, 0, 5)

    expect((await workoutRepo.setsForSession(db, sessionId)).map((s) => s.id)).toEqual([s1, s2])
  })

  it('deleting a set hides it and queues the delete; a second call does nothing', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    const setId = await set(db, sessionId, 0, 5)

    await workoutRepo.deleteSet(db, USER_A, setId, at(7))
    await workoutRepo.deleteSet(db, USER_A, setId, at(8))

    expect(await workoutRepo.setsForSession(db, sessionId)).toEqual([])
    expect((await outbox.due(db, at(10), 500)).map((e) => [e.entity, e.id, e.op])).toEqual([['set_log', setId, 'delete']])
  })

  it('setsForExercise returns the latest sets, newest first, limited', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    for (const [i, minutes] of [5, 8, 11].entries()) await set(db, sessionId, i, minutes)

    const sets = await workoutRepo.setsForExercise(db, EX, 2)

    expect(sets.map((s) => s.setIndex)).toEqual([2, 1])
  })

  it('changesForSession lists the pulled swaps and skips in order', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    await seedChange(db, { sessionId, plannedExerciseKey: 'supino', action: 'swapped', replacementExerciseId: EX, note: 'banco ocupado', at: at(2) })
    await seedChange(db, { sessionId, plannedExerciseKey: 'crucifixo', action: 'skipped', at: at(3) })

    expect(await workoutRepo.changesForSession(db, sessionId)).toMatchObject([
      { plannedExerciseKey: 'supino', action: 'swapped', replacementExerciseId: EX, note: 'banco ocupado' },
      { plannedExerciseKey: 'crucifixo', action: 'skipped', replacementExerciseId: null, note: null },
    ])
  })

  it('a delete that fails to queue leaves the row as it was', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    await db.execute('DROP TABLE outbox')

    await expect(workoutRepo.deleteSession(db, USER_A, sessionId, at(1))).rejects.toThrow()

    expect(await workoutRepo.sessionById(db, sessionId)).not.toBeNull()
  })

  it('exercise notes come back from a pull', async () => {
    const db = await newLocalDb()
    await workoutSessionSync.applyRemote(db, {
      entity: 'workout_session',
      id: 's9',
      version: 5,
      clientUpdatedAt: '2026-10-18T12:00:00.000000+00:00',
      deletedAt: null,
      payload: {
        date: '2026-10-18', plan_version_id: PLAN, workout_day_key: 'a', started_at: '2026-10-18T11:00:00+00:00', ended_at: null, note: null,
        notes: { e1: 'Do servidor' },
      },
    })
    expect((await workoutRepo.sessionById(db, 's9'))!.exerciseNotes).toEqual({ e1: 'Do servidor' })
  })

  it('removeChange soft-deletes the change and queues the delete; a second call does nothing', async () => {
    const db = await newLocalDb()
    const sessionId = await session(db)
    const id = await seedChange(db, { sessionId, plannedExerciseKey: 'supino', action: 'skipped', at: at(2) })

    await workoutRepo.removeChange(db, USER_A, id, at(3))
    await workoutRepo.removeChange(db, USER_A, id, at(4))

    expect(await workoutRepo.changesForSession(db, sessionId)).toEqual([])
    expect((await outbox.due(db, at(10), 500)).map((e) => [e.entity, e.op])).toEqual([['exercise_change', 'delete']])
  })

  it('deleteSession soft-deletes an empty session and queues the delete; one with sets is refused', async () => {
    const db = await newLocalDb()
    const empty = await session(db)
    const used = await session(db)
    await set(db, used, 0, 1)

    await workoutRepo.deleteSession(db, USER_A, empty, at(3))
    await workoutRepo.deleteSession(db, USER_A, empty, at(4)) // second call: nothing
    await expect(workoutRepo.deleteSession(db, USER_A, used, at(5))).rejects.toThrow('The session has sets.')

    expect((await workoutRepo.sessionSummaries(db, 10, 0)).map((r) => r.session.id)).toEqual([used])
    const entries = await outbox.due(db, at(10), 500)
    expect(entries.map((e) => [e.entity, e.id, e.op])).toEqual([['workout_session', empty, 'delete']])
  })

  it('sessionSummaries aggregates set count and volume per session (warm-ups out of the volume), newest first, paged', async () => {
    const db = await newLocalDb()
    const old = await session(db, '2026-10-10')
    await set(db, old, 0, 5)
    const recent = await session(db, '2026-10-18')
    await set(db, recent, 0, 5)
    await set(db, recent, 1, 6, { kind: 'warmup' })
    const gone = await set(db, recent, 2, 7)
    await workoutRepo.deleteSet(db, USER_A, gone, at(8))
    await session(db, '2026-10-12', { dayKey: 'b' })

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
    const sessionId = await session(db)
    await set(db, sessionId, 0, 5)
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

describe('workoutRepo: origin and RPE', () => {
  const base = { deletedAt: null, clientUpdatedAt: '2026-10-18T12:00:00+00:00' }
  const pulledSession = (db: Db, payload: Record<string, unknown>, version = 1) =>
    workoutSessionSync.applyRemote(db, { ...base, entity: 'workout_session', id: 'h1', version, payload })
  const hevyPayload = {
    date: '2026-10-18', plan_version_id: PLAN, workout_day_key: 'a', started_at: '2026-10-18T11:00:00+00:00',
    ended_at: '2026-10-18T12:00:00+00:00', note: null, source: 'hevy', external_title: 'Treino A',
  }

  it('a pulled Hevy session keeps source and external_title', async () => {
    const db = await newLocalDb()
    await pulledSession(db, hevyPayload)

    expect(await workoutRepo.sessionById(db, 'h1')).toMatchObject({ source: 'hevy', externalTitle: 'Treino A', endedAt: '2026-10-18T12:00:00.000Z' })
    expect((await workoutRepo.sessionSummaries(db, 10, 0))[0]!.session).toMatchObject({ source: 'hevy', externalTitle: 'Treino A' })
  })

  it('a pulled session without source (older server) or with an unknown one is from the app', async () => {
    const db = await newLocalDb()
    const { source: _source, external_title: _title, ...older } = hevyPayload
    await pulledSession(db, older)
    expect(await workoutRepo.sessionById(db, 'h1')).toMatchObject({ source: 'app', externalTitle: null })

    await pulledSession(db, { ...hevyPayload, source: 'other' }, 2)
    expect(await workoutRepo.sessionById(db, 'h1')).toMatchObject({ source: 'app', externalTitle: 'Treino A' })
  })

  it('rpe comes from the pull; an older server sends none', async () => {
    const db = await newLocalDb()
    await pulledSession(db, hevyPayload)
    await setLogSync.applyRemote(db, {
      ...base,
      entity: 'set_log',
      id: 'l1',
      version: 1,
      payload: { session_id: 'h1', exercise_id: EX, planned_exercise_key: null, set_index: 0, weight_kg: 80, reps: 8, kind: 'normal', parent_set_id: null, completed_at: '2026-10-18T11:05:00+00:00', rpe: 8.5 },
    })
    await setLogSync.applyRemote(db, {
      ...base,
      entity: 'set_log',
      id: 'l2',
      version: 1,
      // An older server sends no rpe.
      payload: { session_id: 'h1', exercise_id: EX, planned_exercise_key: null, set_index: 1, weight_kg: 80, reps: 8, kind: 'normal', parent_set_id: null, completed_at: '2026-10-18T11:08:00+00:00' },
    })
    expect((await workoutRepo.setsForSession(db, 'h1')).map((s) => s.rpe)).toEqual([8.5, null])
  })
})

describe('workoutRepo.workedOutDates', () => {
  it('lists the days with a session, finished or not, holding a live working set', async () => {
    const db = await newLocalDb()

    const done = await session(db, '2026-10-15')
    await set(db, done, 0, 5)

    const warmupOnly = await session(db, '2026-10-16')
    await set(db, warmupOnly, 0, 5, { kind: 'warmup' })

    const open = await session(db, '2026-10-17', { endedAt: null })
    await set(db, open, 0, 5)

    const deletedSet = await session(db, '2026-10-18')
    const setId = await set(db, deletedSet, 0, 5)
    await workoutRepo.deleteSet(db, USER_A, setId, at(6))

    // Two sessions on one day count once.
    for (const _ of [0, 1]) await set(db, await session(db, '2026-10-19'), 0, 5)

    expect(await workoutRepo.workedOutDates(db, '2026-10-01', '2026-10-31')).toEqual(['2026-10-15', '2026-10-17', '2026-10-19'])
    expect(await workoutRepo.workedOutDates(db, '2026-10-16', '2026-10-18')).toEqual(['2026-10-17'])
  })

  describe('sub-sets', () => {
    it('deleting a set deletes its sub-sets too, queued before the parent', async () => {
      const db = await newLocalDb()
      const sessionId = await session(db)
      const parent = await set(db, sessionId, 0, 5)
      const other = await set(db, sessionId, 1, 6)
      const d1 = await set(db, sessionId, 0, 7, { kind: 'drop', parentSetId: parent, weightKg: 64, reps: 6 })

      await workoutRepo.deleteSet(db, USER_A, parent, at(9))

      expect((await workoutRepo.setsForSession(db, sessionId)).map((s) => s.id)).toEqual([other])
      expect((await outbox.due(db, at(10), 500)).map((e) => [e.id, e.op])).toEqual([
        [d1, 'delete'],
        [parent, 'delete'],
      ])
    })

    it('a set deleted on another device (pulled tombstone) takes the sub-sets along', async () => {
      const db = await newLocalDb()
      const sessionId = await session(db)
      const parent = await set(db, sessionId, 0, 5)
      const d1 = await set(db, sessionId, 0, 6, { kind: 'drop', parentSetId: parent, weightKg: 64, reps: 6 })

      await setLogSync.applyRemote(db, { entity: 'set_log', id: parent, version: 9, payload: null, deletedAt: '2026-10-18T13:00:00+00:00', clientUpdatedAt: '2026-10-18T13:00:00+00:00' })

      expect(await workoutRepo.setsForSession(db, sessionId)).toEqual([])
      expect((await outbox.due(db, at(10), 500)).map((e) => [e.id, e.op])).toEqual([[d1, 'delete']])
    })

    it('the session list counts main sets only', async () => {
      const db = await newLocalDb()
      const sessionId = await session(db)
      const parent = await set(db, sessionId, 0, 5)
      await set(db, sessionId, 0, 6, { kind: 'drop', parentSetId: parent, weightKg: 64, reps: 6 })
      expect((await workoutRepo.sessionSummaries(db, 1, 0))[0]).toMatchObject({ setCount: 1, volume: 80 * 8 + 64 * 6 })
    })
  })
})
