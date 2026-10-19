import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, MemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
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
  /** For screens that need a data router (blockers): renders the routes inside the same providers. */
  const viewRoutes = (routes: RouteObject[]) => {
    const router = createMemoryRouter(routes, { initialEntries })
    const result = render(
      <DataContext value={{ db, userId: USER_A, engine }}>
        <SyncProvider>
          <RouterProvider router={router} />
        </SyncProvider>
      </DataContext>,
    )
    return { ...result, router }
  }
  return { db, engine, view, viewRoutes }
}
