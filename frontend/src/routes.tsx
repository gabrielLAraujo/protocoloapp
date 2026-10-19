import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { RequireAuth } from './auth/RequireAuth'
import { DailyCheckinPage } from './features/checkin/DailyCheckinPage'
import { ExerciseHistoryPage } from './features/workout/ExerciseHistoryPage'
import { HistoryPage } from './features/workout/HistoryPage'
import { WorkoutTodayPage } from './features/workout/WorkoutTodayPage'
import { PlanReviewPage } from './features/plans/PlanReviewPage'
import { PlansPage } from './features/plans/PlansPage'
import { ProtocolView } from './features/plans/ProtocolView'
import { LoginPage } from './features/login/LoginPage'
import { DiagnosticsPage } from './features/settings/DiagnosticsPage'
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
          { path: '/planejamento', element: <PlansPage /> },
          { path: '/planejamento/revisao/:id', element: <PlanReviewPage /> },
          { path: '/planejamento/protocolo', element: <ProtocolView /> },
          { path: '/treino', element: <WorkoutTodayPage /> },
          { path: '/treino/historico', element: <HistoryPage /> },
          { path: '/treino/exercicio/:id', element: <ExerciseHistoryPage /> },
          { path: '/sync', element: <AttentionList /> },
          { path: '/settings/diagnostics', element: <DiagnosticsPage /> },
        ],
      },
    ],
  },
]
