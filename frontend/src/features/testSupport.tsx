import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { DataContext } from '../data/dataContext'
import { SyncEngine } from '../data/syncEngine'
import { newLocalDb, newTestApi, USER_A } from '../test/localDb'
import { SyncProvider } from './sync/SyncProvider'

/** A migrated in-memory database, a real sync engine over the fake `fetch`, and the providers the screens need. */
export async function setupApp(initialEntries?: string[]) {
  const db = await newLocalDb()
  const engine = new SyncEngine(db, newTestApi())
  const wrap = (children: ReactNode) => (
    <MemoryRouter initialEntries={initialEntries}>
      <DataContext value={{ db, userId: USER_A, engine }}>
        <SyncProvider>{children}</SyncProvider>
      </DataContext>
    </MemoryRouter>
  )
  const view = (children: ReactNode) => {
    const result = render(wrap(children))
    return { ...result, rerenderApp: (next: ReactNode) => result.rerender(wrap(next)) }
  }
  return { db, engine, view }
}
