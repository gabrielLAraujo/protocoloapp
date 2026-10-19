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
