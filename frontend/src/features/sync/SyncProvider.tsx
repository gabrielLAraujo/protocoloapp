import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useData } from '../../data/dataContext'
import type { SyncStatus } from '../../data/syncEngine'
import { SyncContext, type Sync } from './syncContext'

const idle: SyncStatus = { pending: 0, rejected: 0, running: false }

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}
const readOnline = () => navigator.onLine

/** Exposes the sync engine's status (the engine is the single source of truth) to the screens. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const engine = useData()?.engine
  const [status, setStatus] = useState<SyncStatus>(idle)
  const online = useSyncExternalStore(subscribeOnline, readOnline)

  useEffect(() => {
    if (engine) return engine.subscribe(setStatus)
  }, [engine])

  const syncNow = useCallback(async () => {
    try {
      await engine?.runOnce()
    } catch (error) {
      console.error('sync failed', error)
    }
  }, [engine])

  // Without an engine (signed out, database opening) there is nothing to report.
  const shown = engine ? status : idle
  const value = useMemo<Sync>(() => ({ ...shown, online, syncNow }), [shown, online, syncNow])
  return <SyncContext value={value}>{children}</SyncContext>
}
