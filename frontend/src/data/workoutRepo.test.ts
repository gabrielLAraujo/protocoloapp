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
      notes: null,
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

  it('exercise notes: set, replace and clear queue the session with a notes object (null when empty); finishing keeps them', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)

    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e1', '  Subir 2 kg  ', at(1))
    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e2', 'Ombro estalando', at(2))
    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e2', 'Ombro estalando', at(3)) // same text: nothing queued
    await workoutRepo.finishSession(db, USER_A, sessionId, at(4))

    expect((await workoutRepo.sessionSummaries(db, 1, 0))[0]!.session.exerciseNotes).toEqual({ e1: 'Subir 2 kg', e2: 'Ombro estalando' })
    let entries = await outbox.due(db, at(10), 500)
    expect(entries).toHaveLength(4)
    expect(JSON.parse(entries[3]!.payload!)).toMatchObject({ notes: { e1: 'Subir 2 kg', e2: 'Ombro estalando' }, ended_at: at(4).toISOString() })

    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e1', '   ', at(5))
    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e2', '', at(6))
    entries = await outbox.due(db, at(10), 500)
    expect(JSON.parse(entries.at(-2)!.payload!).notes).toEqual({ e2: 'Ombro estalando' })
    expect(JSON.parse(entries.at(-1)!.payload!).notes).toBeNull()
    expect((await workoutRepo.sessionSummaries(db, 1, 0))[0]!.session.exerciseNotes).toEqual({})
  })

  it('exercise notes respect the server limits and come back from a pull', async () => {
    const db = await newLocalDb()
    const sessionId = await start(db)

    await expect(workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e1', 'x'.repeat(2001), at(1))).rejects.toThrow('The note is too long.')
    await workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e1', 'x'.repeat(2000), at(1))
    for (let i = 2; i <= 30; i++) await workoutRepo.setExerciseNote(db, USER_A, sessionId, `e${i}`, 'n', at(i))
    await expect(workoutRepo.setExerciseNote(db, USER_A, sessionId, 'e31', 'n', at(40))).rejects.toThrow('Too many exercise notes.')

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
    const pulled = (await workoutRepo.sessionSummaries(db, 10, 0)).find((r) => r.session.id === 's9')!
    expect(pulled.session.exerciseNotes).toEqual({ e1: 'Do servidor' })
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

  it('deleteSession soft-deletes an empty session and queues the delete; one with sets is refused', async () => {
    const db = await newLocalDb()
    const empty = await start(db)
    const used = await start(db)
    await workoutRepo.logSet(db, USER_A, setInput(used, 0), at(1))

    await workoutRepo.deleteSession(db, USER_A, empty, at(3))
    await workoutRepo.deleteSession(db, USER_A, empty, at(4)) // second call: nothing
    await expect(workoutRepo.deleteSession(db, USER_A, used, at(5))).rejects.toThrow('The session has sets.')

    expect((await workoutRepo.openSession(db))?.id).toBe(used)
    expect((await workoutRepo.sessionSummaries(db, 10, 0)).map((r) => r.session.id)).toEqual([used])
    const entries = await outbox.due(db, at(10), 500)
    expect(entries.filter((e) => e.id === empty).map((e) => [e.entity, e.op])).toEqual([
      ['workout_session', 'upsert'],
      ['workout_session', 'delete'],
    ])
    expect(entries.some((e) => e.id === used && e.op === 'delete')).toBe(false)
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

describe('workoutRepo.workedOutDates', () => {
  it('lists the days with a finished session holding a live working set', async () => {
    const db = await newLocalDb()
    const session = (date: string) => workoutRepo.startSession(db, USER_A, { date, planVersionId: PLAN, dayKey: 'a' }, T0)

    const done = await session('2026-10-15')
    await workoutRepo.logSet(db, USER_A, setInput(done, 0), at(5))
    await workoutRepo.finishSession(db, USER_A, done, at(50))

    const warmupOnly = await session('2026-10-16')
    await workoutRepo.logSet(db, USER_A, { ...setInput(warmupOnly, 0), kind: 'warmup' }, at(5))
    await workoutRepo.finishSession(db, USER_A, warmupOnly, at(50))

    const open = await session('2026-10-17')
    await workoutRepo.logSet(db, USER_A, setInput(open, 0), at(5))

    const deletedSet = await session('2026-10-18')
    const setId = await workoutRepo.logSet(db, USER_A, setInput(deletedSet, 0), at(5))
    await workoutRepo.deleteSet(db, USER_A, setId, at(6))
    await workoutRepo.finishSession(db, USER_A, deletedSet, at(50))

    // Two sessions on one day count once.
    for (const _ of [0, 1]) {
      const s = await session('2026-10-19')
      await workoutRepo.logSet(db, USER_A, setInput(s, 0), at(5))
      await workoutRepo.finishSession(db, USER_A, s, at(50))
    }

    expect(await workoutRepo.workedOutDates(db, '2026-10-01', '2026-10-31')).toEqual(['2026-10-15', '2026-10-19'])
    expect(await workoutRepo.workedOutDates(db, '2026-10-16', '2026-10-18')).toEqual([])
  })

  describe('sub-sets', () => {
    it('logSubSet copies the parent fields, links it and is idempotent per parent + kind + ordinal', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 1), at(5))

      const d1 = await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 64, reps: 6 }, at(6))
      // A double tap (or a reopened session) on the same slot writes nothing.
      expect(await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 64, reps: 6 }, at(6))).toBe(d1)
      const rp = await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'rest_pause', ordinal: 1, weightKg: 80, reps: 3 }, at(7))
      const d2 = await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 2, weightKg: 51, reps: 5 }, at(8))

      const sets = await workoutRepo.setsForSession(db, sessionId)
      expect(sets.map((s) => [s.id, s.kind, s.parentSetId, s.setIndex, s.plannedExerciseKey])).toEqual([
        [parent, 'normal', null, 1, 'supino'],
        [d1, 'drop', parent, 1, 'supino'],
        [rp, 'rest_pause', parent, 1, 'supino'],
        [d2, 'drop', parent, 1, 'supino'],
      ])
      const entries = await outbox.due(db, at(10), 500)
      expect(entries.filter((e) => e.entity === 'set_log')).toHaveLength(4)
      expect(JSON.parse(entries.find((e) => e.id === d1)!.payload!)).toMatchObject({ parent_set_id: parent, kind: 'drop', weight_kg: 64, exercise_id: EX })
    })

    it('logSubSet refuses a parent that is gone', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
      await workoutRepo.deleteSet(db, USER_A, parent, at(6))
      await expect(workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 60, reps: 6 }, at(7))).rejects.toThrow()
    })

    it('a sub-set is never stored before its parent, even if the clock went back', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
      await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 60, reps: 6 }, at(1))
      const [p, d] = await workoutRepo.setsForSession(db, sessionId)
      expect(p!.id).toBe(parent)
      expect(Date.parse(d!.completedAt)).toBeGreaterThan(Date.parse(p!.completedAt))
    })

    it('deleting a set deletes its sub-sets too, queued before the parent', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
      const other = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 1), at(6))
      const d1 = await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 64, reps: 6 }, at(7))
      await outbox.ack(db, (await outbox.due(db, at(8), 500)).map((e) => e.seq))

      await workoutRepo.deleteSet(db, USER_A, parent, at(9))

      expect((await workoutRepo.setsForSession(db, sessionId)).map((s) => s.id)).toEqual([other])
      const entries = await outbox.due(db, at(10), 500)
      expect(entries.map((e) => [e.id, e.op])).toEqual([
        [d1, 'delete'],
        [parent, 'delete'],
      ])
    })

    it('a set deleted on another device (pulled tombstone) takes the local sub-sets along', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
      const d1 = await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 64, reps: 6 }, at(6))
      await outbox.ack(db, (await outbox.due(db, at(7), 500)).map((e) => e.seq))

      await setLogSync.applyRemote(db, { entity: 'set_log', id: parent, version: 9, payload: null, deletedAt: '2026-10-18T13:00:00+00:00', clientUpdatedAt: '2026-10-18T13:00:00+00:00' })

      expect(await workoutRepo.setsForSession(db, sessionId)).toEqual([])
      expect((await outbox.due(db, at(10), 500)).map((e) => [e.id, e.op])).toEqual([[d1, 'delete']])
    })

    it('the session list counts main sets only', async () => {
      const db = await newLocalDb()
      const sessionId = await start(db)
      const parent = await workoutRepo.logSet(db, USER_A, setInput(sessionId, 0), at(5))
      await workoutRepo.logSubSet(db, USER_A, { parentSetId: parent, kind: 'drop', ordinal: 1, weightKg: 64, reps: 6 }, at(6))
      expect((await workoutRepo.sessionSummaries(db, 1, 0))[0]).toMatchObject({ setCount: 1, volume: 80 * 8 + 64 * 6 })
    })
  })
})
