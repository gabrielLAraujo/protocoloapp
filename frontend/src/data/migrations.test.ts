import { describe, expect, it } from 'vitest'
import { LATEST_LOCAL_VERSION, migrateLocalDb } from './migrations'
import { createSerializedLocalDb } from './localDb'
import { createSqlJsDriver, createSqlJsLocalDb } from './sqlJsLocalDb'

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
        cardio_done: null, cardio_minutes: null,
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
        cardio_done: 1, cardio_minutes: 30,
      },
      {
        id: 'c2', date: '2026-10-02', sleep_quality: 2, bowel: 'loose', energy_wake: 2, energy_day: 3, anxiety: 4,
        water_l: 1, weight_kg: null, note: null, client_updated_at: '2026-10-02T10:00:00.000Z', version: null,
        deleted_at: '2026-10-02T11:00:00.000Z', cardio_done: null, cardio_minutes: null,
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
})
