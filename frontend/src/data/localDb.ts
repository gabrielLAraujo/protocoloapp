/**
 * The local SQLite database as the data layer sees it. The engine, the outbox and the repositories depend only on this:
 * the platform (Capacitor plugin on Android/web, sql.js in the tests) stays in its own implementation.
 */
export interface LocalDb {
  execute(sql: string, params?: unknown[]): Promise<void>
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  /**
   * Runs `fn` in one transaction: committed when it resolves, rolled back when it throws. Use only `tx` inside `fn`:
   * the outer handle waits for the transaction to end, so awaiting it from inside deadlocks.
   */
  transaction<T>(fn: (tx: LocalDb) => Promise<T>): Promise<T>
}

/** The raw operations of one SQLite connection. */
export interface LocalDbDriver {
  run(sql: string, params: unknown[]): Promise<void>
  all<T>(sql: string, params: unknown[]): Promise<T[]>
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * A LocalDb over a single connection. SQLite transactions belong to the connection, so concurrent callers (the sync
 * engine and a screen saving a check-in) are queued: each statement or transaction runs alone, in call order.
 */
export function createSerializedLocalDb(driver: LocalDbDriver): LocalDb {
  let tail: Promise<unknown> = Promise.resolve()

  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn, fn)
    tail = result.catch(() => undefined)
    return result
  }

  // Inside a transaction: straight to the connection. A nested transaction joins the outer one.
  const inTransaction: LocalDb = {
    execute: (sql, params) => driver.run(sql, params ?? []),
    query: <T>(sql: string, params?: unknown[]) => driver.all<T>(sql, params ?? []),
    transaction: (fn) => fn(inTransaction),
  }

  return {
    execute: (sql, params) => exclusive(() => driver.run(sql, params ?? [])),
    query: <T>(sql: string, params?: unknown[]) => exclusive(() => driver.all<T>(sql, params ?? [])),
    transaction: (fn) =>
      exclusive(async () => {
        await driver.begin()
        let result
        try {
          result = await fn(inTransaction)
        } catch (error) {
          await driver.rollback().catch(() => undefined)
          throw error
        }
        await driver.commit()
        return result
      }),
  }
}
