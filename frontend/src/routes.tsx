import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { RequireAuth } from './auth/RequireAuth'
import { DailyCheckinPage } from './features/checkin/DailyCheckinPage'
import { LoginPage } from './features/login/LoginPage'
import { AttentionList } from './features/sync/AttentionList'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        // "/" is today's check-in until the "Hoje" screen replaces it.
        children: [
          { path: '/', element: <DailyCheckinPage /> },
          { path: '/sync', element: <AttentionList /> },
        ],
      },
    ],
  },
]
