import { createContext, useContext } from 'react'
import type { SyncStatus } from '../../data/syncEngine'

export type Sync = SyncStatus & {
  /** The device reports a network connection (it says nothing about the server being reachable). */
  online: boolean
  /** Runs a sync now; resolves when it ends. Never rejects: failures show up as pending entries. */
  syncNow(): Promise<void>
}

export const SyncContext = createContext<Sync | null>(null)

export function useSync(): Sync {
  const sync = useContext(SyncContext)
  if (!sync) throw new Error('useSync must be used inside <SyncProvider>')
  return sync
}
