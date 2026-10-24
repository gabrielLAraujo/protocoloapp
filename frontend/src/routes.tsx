import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { AchievementsPage } from './features/achievements/AchievementsPage'
import { RequireAuth } from './auth/RequireAuth'
import { CheckinHubPage } from './features/checkin/CheckinHubPage'
import { EveningCheckinPage } from './features/checkin/EveningCheckinPage'
import { MorningCheckinPage } from './features/checkin/MorningCheckinPage'
import { SummaryPage } from './features/summary/SummaryPage'
import { ExerciseHistoryPage } from './features/workout/ExerciseHistoryPage'
import { HistoryPage } from './features/workout/HistoryPage'
import { SessionEditPage } from './features/workout/SessionEditPage'
import { WorkoutTodayPage } from './features/workout/WorkoutTodayPage'
import { PlanReviewPage } from './features/plans/PlanReviewPage'
import { PlansPage } from './features/plans/PlansPage'
import { ProtocolView } from './features/plans/ProtocolView'
import { LoginPage } from './features/login/LoginPage'
import { DiagnosticsPage } from './features/settings/DiagnosticsPage'
import { HevySettingsPage } from './features/settings/hevy/HevySettingsPage'
import { QuestionnaireTemplatePage } from './features/settings/QuestionnaireTemplatePage'
import { SchedulePage } from './features/settings/SchedulePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { AttentionList } from './features/sync/AttentionList'
import { TodayPage } from './features/today/TodayPage'
import { UpdatePage } from './features/update/UpdatePage'

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
          { path: '/conquistas', element: <AchievementsPage /> },
          { path: '/planejamento', element: <PlansPage /> },
          { path: '/planejamento/revisao/:id', element: <PlanReviewPage /> },
          { path: '/planejamento/protocolo', element: <ProtocolView /> },
          { path: '/treino', element: <WorkoutTodayPage /> },
          { path: '/treino/historico', element: <HistoryPage /> },
          { path: '/treino/historico/:id', element: <SessionEditPage /> },
          { path: '/treino/exercicio/:id', element: <ExerciseHistoryPage /> },
          { path: '/atualizacao', element: <UpdatePage /> },
          { path: '/sync', element: <AttentionList /> },
          { path: '/configuracoes', element: <SettingsPage /> },
          { path: '/configuracoes/horarios', element: <SchedulePage /> },
          { path: '/configuracoes/questionario', element: <QuestionnaireTemplatePage /> },
          { path: '/configuracoes/hevy', element: <HevySettingsPage /> },
          { path: '/settings/diagnostics', element: <DiagnosticsPage /> },
        ],
      },
    ],
  },
]
