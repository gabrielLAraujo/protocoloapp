import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/authContext'
import { DataContext, type Data } from './dataContext'
import type { LocalDb } from './localDb'
import { resolveLocalUser } from './localUser'
import { migrateLocalDb } from './migrations'
import { createSqliteLocalDb } from './sqliteLocalDb'
import { SyncEngine } from './syncEngine'

// One database for the app's lifetime; opening it twice (StrictMode, re-login) would create a second connection.
let opening: Promise<LocalDb> | null = null
const openDb = () =>
  (opening ??= (async () => {
    const db = await createSqliteLocalDb()
    await migrateLocalDb(db)
    return db
  })())

/** While signed in: opens the local database, binds it to the user and keeps the sync engine running. */
export function DataProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    if (status !== 'signedIn') return
    let cancelled = false
    let stop: (() => void) | undefined
    void (async () => {
      try {
        const db = await openDb()
        const userId = await resolveLocalUser(db, api)
        if (cancelled || !userId) return
        const engine = new SyncEngine(db, api)
        stop = engine.start()
        setData({ db, userId, engine })
      } catch (error) {
        console.error('local database unavailable', error)
      }
    })()
    return () => {
      cancelled = true
      stop?.()
      setData(null)
    }
  }, [status])

  return <DataContext value={data}>{children}</DataContext>
}
