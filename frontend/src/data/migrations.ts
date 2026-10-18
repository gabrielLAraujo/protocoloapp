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
]

export const LATEST_LOCAL_VERSION = MIGRATIONS.at(-1)!.version

/** Applies the pending migrations, each in its own transaction. Safe to run on every start. */
export async function migrateLocalDb(db: LocalDb): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS local_schema_version (version INTEGER PRIMARY KEY)')
  const [row] = await db.query<{ version: number | null }>('SELECT MAX(version) AS version FROM local_schema_version')
  const current = row?.version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.execute(statement)
      await tx.execute('INSERT INTO local_schema_version (version) VALUES (?)', [migration.version])
    })
  }
}
