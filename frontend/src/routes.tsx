import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './features/login/LoginPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [{ path: '/', element: <AppShell /> }],
  },
]
