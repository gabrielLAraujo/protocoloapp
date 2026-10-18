import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import { Capacitor } from '@capacitor/core'
import { createSerializedLocalDb, type LocalDb } from './localDb'

const sqlite = new SQLiteConnection(CapacitorSQLite)

let webStore: Promise<void> | null = null

/**
 * Web only: the plugin runs on the `jeep-sqlite` element (sql.js over IndexedDB). It loads `/assets/sql-wasm.wasm`,
 * copied there from sql.js by scripts/copy-sql-wasm.mjs.
 */
function initWebStore(): Promise<void> {
  webStore ??= (async () => {
    const { defineCustomElements } = await import('jeep-sqlite/loader')
    defineCustomElements(window)
    if (!document.querySelector('jeep-sqlite')) document.body.appendChild(document.createElement('jeep-sqlite'))
    await customElements.whenDefined('jeep-sqlite')
    await sqlite.initWebStore()
  })()
  return webStore
}

async function connect(name: string): Promise<SQLiteDBConnection> {
  const consistent = (await sqlite.checkConnectionsConsistency()).result
  const exists = (await sqlite.isConnection(name, false)).result
  const connection =
    consistent && exists
      ? await sqlite.retrieveConnection(name, false)
      : await sqlite.createConnection(name, false, 'no-encryption', 1, false)
  await connection.open()
  return connection
}

/** The app's database: native SQLite on Android, jeep-sqlite (IndexedDB) on the web. */
export async function createSqliteLocalDb(name = 'protocolo'): Promise<LocalDb> {
  const web = Capacitor.getPlatform() === 'web'
  if (web) await initWebStore()
  const connection = await connect(name)

  // On the web the database lives in memory and is written to IndexedDB on demand: after every commit and every
  // statement outside a transaction.
  let inTransaction = false
  const persist = async () => {
    if (web && !inTransaction) await sqlite.saveToStore(name)
  }

  return createSerializedLocalDb({
    run: async (sql, params) => {
      // transaction=false: our own BEGIN/COMMIT decide, not the plugin's per-statement transaction.
      await connection.run(sql, params, false)
      await persist()
    },
    all: async <T>(sql: string, params: unknown[]) => ((await connection.query(sql, params)).values ?? []) as T[],
    begin: async () => {
      await connection.beginTransaction()
      inTransaction = true
    },
    commit: async () => {
      await connection.commitTransaction()
      inTransaction = false
      await persist()
    },
    rollback: async () => {
      inTransaction = false
      await connection.rollbackTransaction()
    },
  })
}
