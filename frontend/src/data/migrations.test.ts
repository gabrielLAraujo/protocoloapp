import { describe, expect, it } from 'vitest'
import { LATEST_LOCAL_VERSION, migrateLocalDb } from './migrations'
import { createSerializedLocalDb } from './localDb'
import { createSqlJsDriver, createSqlJsLocalDb } from './sqlJsLocalDb'
import { json, mockFetch } from '../test/fetch-mock'
import { newTestApi } from '../test/localDb'
import { outbox } from './outbox'
import { SyncEngine } from './syncEngine'
import { syncState } from './syncState'
import { workoutRepo } from './workoutRepo'

describe('migrateLocalDb', () => {
  it('migrate is idempotent', async () => {
    const db = await createSqlJsLocalDb()

    await migrateLocalDb(db)
    await migrateLocalDb(db)

    const versions = await db.query<{ version: number }>('SELECT version FROM local_schema_version ORDER BY version')
    expect(versions.map((row) => row.version)).toEqual(Array.from({ length: LATEST_LOCAL_VERSION }, (_, i) => i + 1))
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['adherence_logs', 'daily_checkins', 'local_schema_version', 'outbox', 'schedule_slots', 'sync_state', 'sync_unknown']),
    )
  })

  it('a failing transaction leaves nothing behind', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db)

    await expect(
      db.transaction(async (tx) => {
        await tx.execute("INSERT INTO sync_state (key, value) VALUES ('k', 'v')")
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await db.query('SELECT * FROM sync_state')).toEqual([])
  })

  it('serializes concurrent transactions on the single connection', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db)
    const order: string[] = []

    await Promise.all([
      db.transaction(async (tx) => {
        order.push('a:start')
        await tx.execute("INSERT INTO sync_state (key, value) VALUES ('a', '1')")
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push('a:end')
      }),
      db.transaction(async (tx) => {
        order.push('b:start')
        await tx.execute("INSERT INTO sync_state (key, value) VALUES ('b', '1')")
        order.push('b:end')
      }),
    ])

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('a failed commit rolls back and the next transaction works', async () => {
    const driver = await createSqlJsDriver()
    let failCommit = false
    const db = createSerializedLocalDb({
      ...driver,
      // Fails without ending the transaction, like a commit that errors out (e.g. SQLITE_BUSY).
      commit: async () => {
        if (failCommit) {
          failCommit = false
          throw new Error('commit failed')
        }
        await driver.commit()
      },
    })
    await migrateLocalDb(db)
    failCommit = true

    await expect(db.transaction((tx) => tx.execute("INSERT INTO sync_state (key, value) VALUES ('a', '1')"))).rejects.toThrow(
      'commit failed',
    )
    await db.transaction((tx) => tx.execute("INSERT INTO sync_state (key, value) VALUES ('b', '1')"))

    expect(await db.query('SELECT key FROM sync_state')).toEqual([{ key: 'b' }])
  })
})

describe('local migration 2', () => {
  it('keeps the check-ins and outbox of a device on version 1 and adds the new tables', async () => {
    const db = await createSqlJsLocalDb()
    // Version 1 as released.
    await migrateLocalDb(db, 1)
    await db.execute(
      `INSERT INTO daily_checkins (id, date, sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note, client_updated_at, version, deleted_at)
       VALUES ('c1', '2026-10-01', 4, 'normal', 3, 4, 2, 2.5, 80.4, 'ok', '2026-10-01T10:00:00.000Z', 7, NULL)`,
    )
    await db.execute(
      "INSERT INTO outbox (entity, id, op, payload, client_updated_at, next_attempt_at) VALUES ('daily_checkin', 'c1', 'upsert', '{}', '2026-10-01T10:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT * FROM daily_checkins')).toEqual([
      {
        id: 'c1', date: '2026-10-01', sleep_quality: 4, bowel: 'normal', energy_wake: 3, energy_day: 4, anxiety: 2,
        water_l: 2.5, weight_kg: 80.4, note: 'ok', client_updated_at: '2026-10-01T10:00:00.000Z', version: 7, deleted_at: null,
        cardio_done: null, cardio_minutes: null, stress: null, mood: null,
      },
    ])
    expect(await db.query('SELECT id FROM outbox')).toEqual([{ id: 'c1' }])
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['plan_versions', 'exercises', 'workout_sessions', 'set_logs', 'exercise_changes', 'rotation_overrides']),
    )
  })
})

describe('local migration 3', () => {
  it('adds exercise_notes to the sessions of a device on version 2 without touching them', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 2)
    await db.execute(
      `INSERT INTO workout_sessions (id, date, plan_version_id, workout_day_key, started_at, ended_at, note, client_updated_at, version, deleted_at)
       VALUES ('s1', '2026-10-18', 'p1', 'a', '2026-10-18T11:00:00.000Z', NULL, 'ok', '2026-10-18T11:00:00.000Z', 3, NULL)`,
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT id, note, exercise_notes FROM workout_sessions')).toEqual([{ id: 's1', note: 'ok', exercise_notes: null }])
  })
})

describe('local migration 5', () => {
  it('rebuilds daily_checkins with nullable part fields, keeping every row (live and deleted) and the date index', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 4)
    await db.execute(
      `INSERT INTO daily_checkins (id, date, sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note, client_updated_at, version, deleted_at, cardio_done, cardio_minutes)
       VALUES ('c1', '2026-10-01', 4, 'normal', 3, 4, 2, 2.5, 80.4, 'ok', '2026-10-01T10:00:00.000Z', 7, NULL, 1, 30),
              ('c2', '2026-10-02', 2, 'loose', 2, 3, 4, 1, NULL, NULL, '2026-10-02T10:00:00.000Z', NULL, '2026-10-02T11:00:00.000Z', NULL, NULL)`,
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT * FROM daily_checkins ORDER BY id')).toEqual([
      {
        id: 'c1', date: '2026-10-01', sleep_quality: 4, bowel: 'normal', energy_wake: 3, energy_day: 4, anxiety: 2,
        water_l: 2.5, weight_kg: 80.4, note: 'ok', client_updated_at: '2026-10-01T10:00:00.000Z', version: 7, deleted_at: null,
        cardio_done: 1, cardio_minutes: 30, stress: null, mood: null,
      },
      {
        id: 'c2', date: '2026-10-02', sleep_quality: 2, bowel: 'loose', energy_wake: 2, energy_day: 3, anxiety: 4,
        water_l: 1, weight_kg: null, note: null, client_updated_at: '2026-10-02T10:00:00.000Z', version: null,
        deleted_at: '2026-10-02T11:00:00.000Z', cardio_done: null, cardio_minutes: null, stress: null, mood: null,
      },
    ])
    // A row with the parts empty (cardio only) now fits.
    await db.execute(
      "INSERT INTO daily_checkins (id, date, client_updated_at, cardio_done) VALUES ('c3', '2026-10-03', '2026-10-03T10:00:00.000Z', 0)",
    )
    const indexes = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'daily_checkins'")
    expect(indexes.map((i) => i.name)).toContain('ix_daily_checkins_date')
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'daily_checkins%'")
    expect(tables.map((t) => t.name)).toEqual(['daily_checkins'])
  })
})

describe('local migration 6', () => {
  it('adds the catalog tables and exercises.catalog_id without touching the exercises of a device on version 5', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 5)
    await db.execute(
      `INSERT INTO exercises (id, name, normalized_name, primary_muscle_group, aliases, client_updated_at, version, deleted_at)
       VALUES ('x1', 'Stiff', 'stiff', 'hamstrings', '["a"]', '2026-10-01T10:00:00.000Z', 2, NULL)`,
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT id, name, aliases, catalog_id FROM exercises')).toEqual([{ id: 'x1', name: 'Stiff', aliases: '["a"]', catalog_id: null }])
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('catalog_exercises', 'kv')")
    expect(tables.map((t) => t.name).sort()).toEqual(['catalog_exercises', 'kv'])
    await db.execute("INSERT INTO catalog_exercises (id, name) VALUES ('c1', 'Curl')")
    expect(await db.query('SELECT * FROM catalog_exercises')).toEqual([
      { id: 'c1', name: 'Curl', body_parts: '[]', target_muscles: '[]', equipments: '[]', gif_url: null },
    ])
  })
})

describe('local migration 8', () => {
  it('adds the update tables without touching the data of a device on version 7', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 7)
    await db.execute(
      `INSERT INTO diet_deviations (id, date, meal_key, time, description, quantity, client_updated_at, version, deleted_at)
       VALUES ('d1', '2026-10-19', '1', NULL, 'Exemplo', NULL, '2026-10-19T10:00:00.000Z', 3, NULL)`,
    )
    await db.execute(
      "INSERT INTO outbox (entity, id, op, payload, client_updated_at, next_attempt_at) VALUES ('diet_deviation', 'd1', 'upsert', '{}', '2026-10-19T10:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT id, description, version FROM diet_deviations')).toEqual([{ id: 'd1', description: 'Exemplo', version: 3 }])
    expect(await db.query('SELECT id FROM outbox')).toEqual([{ id: 'd1' }])
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('questionnaire_templates', 'update_cycles', 'update_photo_thumbs')",
    )
    expect(tables.map((t) => t.name).sort()).toEqual(['questionnaire_templates', 'update_cycles', 'update_photo_thumbs'])
    await db.execute(
      "INSERT INTO update_cycles (id, protocol_version_id, period_start, period_end, status, client_updated_at) VALUES ('u1', 'p1', '2026-10-05', '2026-10-26', 'collecting', '2026-10-19T10:00:00.000Z')",
    )
    expect(await db.query('SELECT answers, photos, sent_at FROM update_cycles')).toEqual([{ answers: '{}', photos: '[]', sent_at: null }])
  })

  it('adds stress and mood (null) to the check-ins of a device on version 8', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 8)
    await db.execute(
      `INSERT INTO daily_checkins (id, date, energy_day, anxiety, water_l, client_updated_at, version)
       VALUES ('c1', '2026-10-20', 4, 2, 2.5, '2026-10-20T21:00:00.000Z', 5)`,
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT id, anxiety, stress, mood, version FROM daily_checkins')).toEqual([
      { id: 'c1', anxiety: 2, stress: null, mood: null, version: 5 },
    ])
  })
})

describe('local migration 10', () => {
  it('adds source (app), external_title and rpe to the sessions and sets of a device on version 9, keeping their data', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 9)
    await db.execute(
      `INSERT INTO workout_sessions (id, date, plan_version_id, workout_day_key, started_at, ended_at, note, client_updated_at, version, deleted_at)
       VALUES ('s1', '2026-10-18', 'p1', 'a', '2026-10-18T11:00:00.000Z', '2026-10-18T12:00:00.000Z', 'ok', '2026-10-18T12:00:00.000Z', 3, NULL),
              ('s2', '2026-10-19', 'p1', 'b', '2026-10-19T11:00:00.000Z', NULL, NULL, '2026-10-19T11:00:00.000Z', NULL, '2026-10-19T11:30:00.000Z')`,
    )
    await db.execute(
      `INSERT INTO set_logs (id, session_id, exercise_id, planned_exercise_key, set_index, weight_kg, reps, kind, parent_set_id, completed_at, client_updated_at, version, deleted_at)
       VALUES ('l1', 's1', 'x1', 'e1', 0, 80, 8, 'normal', NULL, '2026-10-18T11:05:00.000Z', '2026-10-18T11:05:00.000Z', 4, NULL)`,
    )

    await migrateLocalDb(db)

    expect(await db.query('SELECT id, note, version, deleted_at, source, external_title FROM workout_sessions ORDER BY id')).toEqual([
      { id: 's1', note: 'ok', version: null, deleted_at: null, source: 'app', external_title: null },
      { id: 's2', note: null, version: null, deleted_at: '2026-10-19T11:30:00.000Z', source: 'app', external_title: null },
    ])
    expect(await db.query('SELECT id, weight_kg, reps, version, rpe FROM set_logs')).toEqual([{ id: 'l1', weight_kg: 80, reps: 8, version: null, rpe: null }])
  })

  it('resets the pull cursor: the next sync pulls everything again, restoring source, title and rpe without clobbering a pending local edit', async () => {
    const db = await createSqlJsLocalDb()
    await migrateLocalDb(db, 9)
    // Pulled by the older version: s1 came from Hevy (source and title dropped), l1 had an RPE (dropped); s2 has a local
    // edit still waiting in the outbox (in backoff), newer than the server's copy.
    await db.execute(
      `INSERT INTO workout_sessions (id, date, plan_version_id, workout_day_key, started_at, ended_at, note, client_updated_at, version, deleted_at)
       VALUES ('s1', '2026-10-18', 'p1', 'a', '2026-10-18T11:00:00.000Z', '2026-10-18T12:00:00.000Z', NULL, '2026-10-18T12:00:00.000Z', 3, NULL),
              ('s2', '2026-10-19', 'p1', 'b', '2026-10-19T11:00:00.000Z', '2026-10-19T12:00:00.000Z', 'local edit', '2026-10-19T13:00:00.000Z', 5, NULL)`,
    )
    await db.execute(
      `INSERT INTO set_logs (id, session_id, exercise_id, planned_exercise_key, set_index, weight_kg, reps, kind, parent_set_id, completed_at, client_updated_at, version, deleted_at)
       VALUES ('l1', 's1', 'x1', NULL, 0, 80, 8, 'normal', NULL, '2026-10-18T11:05:00.000Z', '2026-10-18T11:05:00.000Z', 4, NULL)`,
    )
    await db.execute(
      "INSERT INTO daily_checkins (id, date, energy_day, client_updated_at, version) VALUES ('c1', '2026-10-18', 4, '2026-10-18T21:00:00.000Z', 7)",
    )
    const now = new Date('2026-10-24T12:00:00.000Z')
    await outbox.enqueue(db, { entity: 'workout_session', id: 's2', op: 'upsert', payload: '{}', clientUpdatedAt: '2026-10-19T13:00:00.000Z' })
    const [entry] = await outbox.due(db, now, 10)
    await outbox.fail(db, [entry!.seq], now)
    await syncState.set(db, 'last_since', '42')

    await migrateLocalDb(db)
    expect(await syncState.get(db, 'last_since')).toBeNull()

    const sessionPayload = { plan_version_id: 'p1', ended_at: null, note: null }
    const calls = mockFetch({
      'POST /api/sync/push': () => json({ results: [] }),
      'GET /api/sync/pull': () =>
        json({
          records: [
            { entity: 'workout_session', id: 's1', version: 3, deletedAt: null, clientUpdatedAt: '2026-10-18T12:00:00+00:00',
              payload: { ...sessionPayload, date: '2026-10-18', workout_day_key: 'a', started_at: '2026-10-18T11:00:00+00:00', ended_at: '2026-10-18T12:00:00+00:00', source: 'hevy', external_title: 'Treino A' } },
            { entity: 'set_log', id: 'l1', version: 4, deletedAt: null, clientUpdatedAt: '2026-10-18T11:05:00+00:00',
              payload: { session_id: 's1', exercise_id: 'x1', planned_exercise_key: null, set_index: 0, weight_kg: 80, reps: 8, kind: 'normal', parent_set_id: null, completed_at: '2026-10-18T11:05:00+00:00', rpe: 8.5 } },
            { entity: 'workout_session', id: 's2', version: 5, deletedAt: null, clientUpdatedAt: '2026-10-19T12:00:00+00:00',
              payload: { ...sessionPayload, date: '2026-10-19', workout_day_key: 'b', started_at: '2026-10-19T11:00:00+00:00', note: 'server', source: 'app' } },
            { entity: 'daily_checkin', id: 'c1', version: 7, deletedAt: null, clientUpdatedAt: '2026-10-18T21:00:00+00:00',
              payload: { date: '2026-10-18', energy_day: 1 } },
          ],
          nextSince: 7,
          hasMore: false,
        }),
    })

    await new SyncEngine(db, newTestApi(), () => now).runOnce()

    expect(calls.filter((c) => c.path.startsWith('/api/sync/pull')).map((c) => c.path)).toEqual(['/api/sync/pull?since=0&limit=500'])
    expect(await workoutRepo.sessionById(db, 's1')).toMatchObject({ source: 'hevy', externalTitle: 'Treino A' })
    expect(await db.query('SELECT version, rpe FROM set_logs')).toEqual([{ version: 4, rpe: 8.5 }])
    expect(await workoutRepo.sessionById(db, 's2')).toMatchObject({ note: 'local edit' })
    expect(await outbox.pendingCount(db)).toBe(1)
    // Rows of other entities the device already has are skipped (same version).
    expect(await db.query('SELECT energy_day FROM daily_checkins')).toEqual([{ energy_day: 4 }])
    expect(await syncState.get(db, 'last_since')).toBe('7')
  })
})
