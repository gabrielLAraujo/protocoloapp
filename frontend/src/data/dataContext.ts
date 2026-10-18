import { createContext, useContext } from 'react'
import type { LocalDb } from './localDb'
import type { SyncEngine } from './syncEngine'

/** The local data of the signed-in user, once the database is open and the user known. */
export type Data = { db: LocalDb; userId: string; engine: SyncEngine }

export const DataContext = createContext<Data | null>(null)

/** Null while the database opens, when signed out, or on a first start without network (user not known yet). */
export function useData(): Data | null {
  return useContext(DataContext)
}
