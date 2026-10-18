import initSqlJs, { type SqlValue } from 'sql.js'
import { createSerializedLocalDb, type LocalDb, type LocalDbDriver } from './localDb'

/** In-memory SQLite (sql.js) behind the same LocalDb as the app. For the tests. */
export async function createSqlJsLocalDb(): Promise<LocalDb> {
  return createSerializedLocalDb(await createSqlJsDriver())
}

/** The raw sql.js connection, for tests that wrap the driver (e.g. to make a commit fail). */
export async function createSqlJsDriver(): Promise<LocalDbDriver> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return {
    run: async (sql, params) => {
      db.run(sql, params as SqlValue[])
    },
    all: async <T>(sql: string, params: unknown[]) => {
      const statement = db.prepare(sql)
      try {
        statement.bind(params as SqlValue[])
        const rows: T[] = []
        while (statement.step()) rows.push(statement.getAsObject() as T)
        return rows
      } finally {
        statement.free()
      }
    },
    begin: async () => {
      db.run('BEGIN')
    },
    commit: async () => {
      db.run('COMMIT')
    },
    rollback: async () => {
      db.run('ROLLBACK')
    },
  }
}
