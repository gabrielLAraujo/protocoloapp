import initSqlJs, { type SqlValue } from 'sql.js'
import { createSerializedLocalDb, type LocalDb } from './localDb'

/** In-memory SQLite (sql.js) behind the same LocalDb as the app. For the tests. */
export async function createSqlJsLocalDb(): Promise<LocalDb> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return createSerializedLocalDb({
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
  })
}
