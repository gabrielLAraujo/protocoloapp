import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { RequireAuth } from './auth/RequireAuth'
import { CheckinHubPage } from './features/checkin/CheckinHubPage'
import { EveningCheckinPage } from './features/checkin/EveningCheckinPage'
import { MorningCheckinPage } from './features/checkin/MorningCheckinPage'
import { SummaryPage } from './features/summary/SummaryPage'
import { ExerciseHistoryPage } from './features/workout/ExerciseHistoryPage'
import { HistoryPage } from './features/workout/HistoryPage'
import { WorkoutTodayPage } from './features/workout/WorkoutTodayPage'
import { PlanReviewPage } from './features/plans/PlanReviewPage'
import { PlansPage } from './features/plans/PlansPage'
import { ProtocolView } from './features/plans/ProtocolView'
import { LoginPage } from './features/login/LoginPage'
import { DiagnosticsPage } from './features/settings/DiagnosticsPage'
import { SchedulePage } from './features/settings/SchedulePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { AttentionList } from './features/sync/AttentionList'
import { TodayPage } from './features/today/TodayPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <SummaryPage /> },
          { path: '/hoje', element: <TodayPage /> },
          { path: '/checkin', element: <CheckinHubPage /> },
          { path: '/checkin/manha', element: <MorningCheckinPage /> },
          { path: '/checkin/noite', element: <EveningCheckinPage /> },
          { path: '/planejamento', element: <PlansPage /> },
          { path: '/planejamento/revisao/:id', element: <PlanReviewPage /> },
          { path: '/planejamento/protocolo', element: <ProtocolView /> },
          { path: '/treino', element: <WorkoutTodayPage /> },
          { path: '/treino/historico', element: <HistoryPage /> },
          { path: '/treino/exercicio/:id', element: <ExerciseHistoryPage /> },
          { path: '/sync', element: <AttentionList /> },
          { path: '/configuracoes', element: <SettingsPage /> },
          { path: '/configuracoes/horarios', element: <SchedulePage /> },
          { path: '/settings/diagnostics', element: <DiagnosticsPage /> },
        ],
      },
    ],
  },
]
