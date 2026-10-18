import { describe, expect, it } from 'vitest'
import { LATEST_LOCAL_VERSION, migrateLocalDb } from './migrations'
import { createSqlJsLocalDb } from './sqlJsLocalDb'

describe('migrateLocalDb', () => {
  it('migrate is idempotent', async () => {
    const db = await createSqlJsLocalDb()

    await migrateLocalDb(db)
    await migrateLocalDb(db)

    const versions = await db.query<{ version: number }>('SELECT version FROM local_schema_version ORDER BY version')
    expect(versions.map((row) => row.version)).toEqual(Array.from({ length: LATEST_LOCAL_VERSION }, (_, i) => i + 1))
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['daily_checkins', 'local_schema_version', 'outbox', 'sync_state', 'sync_unknown']),
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
})
