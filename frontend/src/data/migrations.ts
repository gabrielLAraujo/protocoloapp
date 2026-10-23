import type { LocalDb } from './localDb'

/**
 * Numbered, append-only migrations of the local database. Never edit a released one: add the next number.
 * Dates and timestamps are ISO-8601 text (UTC, `toISOString()`), so they compare correctly as strings.
 */
const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      // Engine state: last_since (pull cursor), last_sync_at, user_id (owner of the local data).
      'CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      // Local changes not yet acknowledged by the server, sent in seq order. Rejected ones stay for the user to see.
      `CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
        payload TEXT,
        client_updated_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected')),
        errors TEXT
      )`,
      'CREATE INDEX ix_outbox_status_seq ON outbox (status, seq)',
      'CREATE INDEX ix_outbox_entity_id ON outbox (entity, id)',
      // Pulled records of entities this app version does not know yet: applied when an update brings their adapter.
      'CREATE TABLE sync_unknown (entity TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (entity, id))',
      `CREATE TABLE daily_checkins (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        sleep_quality INTEGER NOT NULL,
        bowel TEXT NOT NULL,
        energy_wake INTEGER NOT NULL,
        energy_day INTEGER NOT NULL,
        anxiety INTEGER NOT NULL,
        water_l REAL NOT NULL,
        weight_kg REAL,
        note TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_daily_checkins_date ON daily_checkins (date)',
    ],
  },
  {
    version: 2,
    // Additive only: devices already hold real check-ins.
    statements: [
      'ALTER TABLE daily_checkins ADD COLUMN cardio_done INTEGER',
      'ALTER TABLE daily_checkins ADD COLUMN cardio_minutes INTEGER',
      // Plans and the exercise catalog are written by the server only (pull).
      `CREATE TABLE plan_versions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        document TEXT NOT NULL,
        low_confidence TEXT NOT NULL DEFAULT '[]',
        activated_at TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_plan_versions_kind_status ON plan_versions (kind, status)',
      `CREATE TABLE exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        primary_muscle_group TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      `CREATE TABLE workout_sessions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        plan_version_id TEXT NOT NULL,
        workout_day_key TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        note TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_workout_sessions_date ON workout_sessions (date)',
      `CREATE TABLE set_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        planned_exercise_key TEXT,
        set_index INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        reps INTEGER NOT NULL,
        kind TEXT NOT NULL,
        parent_set_id TEXT,
        completed_at TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_set_logs_session ON set_logs (session_id)',
      'CREATE INDEX ix_set_logs_exercise ON set_logs (exercise_id, completed_at)',
      `CREATE TABLE exercise_changes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        planned_exercise_key TEXT NOT NULL,
        action TEXT NOT NULL,
        replacement_exercise_id TEXT,
        note TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_exercise_changes_session ON exercise_changes (session_id)',
      `CREATE TABLE rotation_overrides (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        workout_day_key TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_rotation_overrides_date ON rotation_overrides (date)',
    ],
  },
  {
    // Per-exercise notes of a session: JSON object planned_exercise_key -> text, null when there are none.
    version: 3,
    statements: ['ALTER TABLE workout_sessions ADD COLUMN exercise_notes TEXT'],
  },
  {
    // The day's times and marks (screen "Hoje"). Additive only.
    version: 4,
    statements: [
      // time: HH:mm; reminder_enabled: 0/1.
      `CREATE TABLE schedule_slots (
        id TEXT PRIMARY KEY,
        slot TEXT NOT NULL,
        day_type TEXT NOT NULL,
        time TEXT NOT NULL,
        reminder_enabled INTEGER NOT NULL,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_schedule_slots_slot ON schedule_slots (slot, day_type)',
      `CREATE TABLE adherence_logs (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        note TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_adherence_logs_date ON adherence_logs (date)',
    ],
  },
  {
    // Check-in in parts (morning, evening, cardio): the part fields become nullable. SQLite cannot drop NOT NULL, so
    // the table is rebuilt; every row is copied (same columns, same order) and the index recreated.
    version: 5,
    statements: [
      `CREATE TABLE daily_checkins_v5 (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        sleep_quality INTEGER,
        bowel TEXT,
        energy_wake INTEGER,
        energy_day INTEGER,
        anxiety INTEGER,
        water_l REAL,
        weight_kg REAL,
        note TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT,
        cardio_done INTEGER,
        cardio_minutes INTEGER
      )`,
      `INSERT INTO daily_checkins_v5
         (id, date, sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note, client_updated_at, version, deleted_at, cardio_done, cardio_minutes)
       SELECT id, date, sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note, client_updated_at, version, deleted_at, cardio_done, cardio_minutes
       FROM daily_checkins`,
      'DROP TABLE daily_checkins',
      'ALTER TABLE daily_checkins_v5 RENAME TO daily_checkins',
      'CREATE INDEX ix_daily_checkins_date ON daily_checkins (date)',
    ],
  },
  {
    // Exercise media: a copy of the server's ExerciseDB catalog (replaced whole on refresh), a small key/value store (the catalog
    // version/ETag) and the link of each exercise to its catalog item. Additive only.
    version: 6,
    statements: [
      // body_parts, target_muscles and equipments are JSON arrays of text.
      `CREATE TABLE catalog_exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body_parts TEXT NOT NULL DEFAULT '[]',
        target_muscles TEXT NOT NULL DEFAULT '[]',
        equipments TEXT NOT NULL DEFAULT '[]',
        gif_url TEXT
      )`,
      'CREATE INDEX ix_catalog_exercises_name ON catalog_exercises (name)',
      'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'ALTER TABLE exercises ADD COLUMN catalog_id TEXT',
    ],
  },
  {
    // Diet deviations: what was eaten outside the plan, inside a meal (meal_key) or as an extra meal (meal_key NULL).
    version: 7,
    statements: [
      `CREATE TABLE diet_deviations (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        meal_key TEXT,
        time TEXT,
        description TEXT NOT NULL,
        quantity TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_diet_deviations_date ON diet_deviations (date)',
    ],
  },
  {
    // The update (questionnaire and photos). Additive only.
    version: 8,
    statements: [
      // document: the template as JSON text (camelCase keys inside). One live per user.
      `CREATE TABLE questionnaire_templates (
        id TEXT PRIMARY KEY,
        document TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      // Created by the server; answers (JSON object key -> text) and photos (JSON array) are the device's part.
      `CREATE TABLE update_cycles (
        id TEXT PRIMARY KEY,
        protocol_version_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL,
        answers TEXT NOT NULL DEFAULT '{}',
        photos TEXT NOT NULL DEFAULT '[]',
        sent_at TEXT,
        client_updated_at TEXT NOT NULL,
        version INTEGER,
        deleted_at TEXT
      )`,
      'CREATE INDEX ix_update_cycles_period_start ON update_cycles (period_start)',
      // Local only (never synced): a small thumbnail per photo sent, so the device never keeps the full image.
      `CREATE TABLE update_photo_thumbs (
        file_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        pose TEXT NOT NULL,
        data_url TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX ix_update_photo_thumbs_cycle ON update_photo_thumbs (cycle_id, pose)',
    ],
  },
  {
    // Evening meters: stress (0–10) and mood (1–5), optional. Additive only.
    version: 9,
    statements: ['ALTER TABLE daily_checkins ADD COLUMN stress INTEGER', 'ALTER TABLE daily_checkins ADD COLUMN mood INTEGER'],
  },
]

export const LATEST_LOCAL_VERSION = MIGRATIONS.at(-1)!.version

/** Applies the pending migrations (up to `upTo`, which only tests lower), each in its own transaction. Safe to run on every start. */
export async function migrateLocalDb(db: LocalDb, upTo: number = LATEST_LOCAL_VERSION): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS local_schema_version (version INTEGER PRIMARY KEY)')
  const [row] = await db.query<{ version: number | null }>('SELECT MAX(version) AS version FROM local_schema_version')
  const current = row?.version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > upTo) continue
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.execute(statement)
      await tx.execute('INSERT INTO local_schema_version (version) VALUES (?)', [migration.version])
    })
  }
}
