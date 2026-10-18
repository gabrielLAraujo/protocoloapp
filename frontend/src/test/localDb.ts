import createClient from 'openapi-fetch'
import type { ApiClient } from '../data/apiClient'
import type { LocalDb } from '../data/localDb'
import { migrateLocalDb } from '../data/migrations'
import { createSqlJsLocalDb } from '../data/sqlJsLocalDb'

/** A migrated in-memory database (sql.js). */
export async function newLocalDb(): Promise<LocalDb> {
  const db = await createSqlJsLocalDb()
  await migrateLocalDb(db)
  return db
}

/** An API client without the auth middleware, over the fake `fetch` of `mockFetch`. */
export function newTestApi(): ApiClient {
  return createClient({ baseUrl: 'http://api.test', fetch: (request) => globalThis.fetch(request) })
}

/** Fictitious ids. */
export const USER_A = '0b6d3c55-6c2f-4c4e-9f52-6a0d6d1f0a01'
export const USER_B = '0b6d3c55-6c2f-4c4e-9f52-6a0d6d1f0a02'
