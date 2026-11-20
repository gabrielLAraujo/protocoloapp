import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RouteObject } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { routes } from '../../routes'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { BENCH, PLAN, seedExercises, seedHevySession, seedPastSession, seedPlan } from '../workout/testData'
import { TrainingPage } from './TrainingPage'

// Local noon of Sunday 2026-10-18: the rotation anchor of the fixtures is that day (position 0).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0))
  mockFetch({}) // offline
})

const HEVY = '7d1f2a10-0000-5000-8000-00000000f001'

describe('TrainingPage', () => {
  it('opens without a workout plan or protocol: history and empty messages in the charts', async () => {
    const app = await setupApp(['/treino'])
    app.view(<TrainingPage />)

    expect(await screen.findByRole('heading', { name: 'Treino' })).toBeInTheDocument()
    expect(screen.getByText('Nenhuma ficha de treino ativa.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir para o Planejamento' })).toHaveAttribute('href', '/planejamento')
    expect(screen.queryByRole('button', { name: 'Trocar' })).not.toBeInTheDocument()
    expect(screen.getByText('Nenhum treino previsto ou feito no período.')).toBeInTheDocument()
    expect(screen.getByText('Sem cargas registradas no período.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum treino registrado ainda.')).toBeInTheDocument()
  })

  it('"Trocar" saves today\'s swap and "Previsto hoje" follows it', async () => {
    const app = await setupApp(['/treino'])
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    const user = userEvent.setup()
    app.view(<TrainingPage />)

    expect(await screen.findByText('Previsto hoje:', { exact: false })).toHaveTextContent('Previsto hoje: Treino A')
    await user.click(screen.getByRole('button', { name: 'Trocar' }))
    const panel = screen.getByRole('region', { name: 'Trocar o treino de hoje' })
    expect(within(panel).getByRole('button', { name: 'Descanso' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: /Treino B/ }))

    await waitFor(() => expect(screen.getByText('Previsto hoje:', { exact: false })).toHaveTextContent('Previsto hoje: Treino B'))
    expect(screen.queryByRole('region', { name: 'Trocar o treino de hoje' })).not.toBeInTheDocument()
    expect((await rotationOverrideRepo.between(app.db, '2026-10-18', '2026-10-18')).map((o) => o.dayKey)).toEqual(['b'])

    await user.click(screen.getByRole('button', { name: 'Trocar' }))
    await user.click(screen.getByRole('button', { name: 'Descanso' }))
    await waitFor(() => expect(screen.getByText('Previsto hoje:', { exact: false })).toHaveTextContent('Previsto hoje: Descanso'))
  })

  it('shows the weekly bars, the calendar and the load chart of the trained exercises', async () => {
    const app = await setupApp(['/treino'])
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'off'])
    await seedPastSession(app.db, '2026-10-13', BENCH, [[70, 12]])
    await seedPastSession(app.db, '2026-10-16', BENCH, [[80, 10]])
    app.view(<TrainingPage />)

    const weeks = await screen.findByRole('list', { name: 'Treinos por semana' })
    expect(within(weeks).getByText(/^Semana de 12\/10: 2 de \d+$/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Calendário do ciclo' })).toBeInTheDocument()

    const loads = screen.getByRole('region', { name: 'Evolução de carga' })
    expect(within(loads).getByRole('img', { name: /1RM estimado por sessão/ })).toBeInTheDocument()
    expect(within(loads).getByRole('link', { name: /Supino reto/ })).toHaveAttribute('href', `/treino/exercicio/${BENCH}`)
    expect(screen.queryByText('Sem cargas registradas no período.')).not.toBeInTheDocument()
  })

  it('lists every session newest first: a Hevy one with its chip and title, an open app one "Em andamento"', async () => {
    const app = await setupApp(['/treino'])
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedHevySession(app.db, HEVY, '2026-10-12', BENCH, [[82.5, 8]], 'Peito exemplo')
    const open = await workoutRepo.startSession(app.db, USER_A, { date: '2026-10-14', planVersionId: PLAN, dayKey: 'b' }, new Date(2026, 9, 14, 9))
    app.view(<TrainingPage />)

    const list = await screen.findByRole('region', { name: 'Histórico' })
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('14/10/2026')
    expect(within(first!).getByText('Em andamento')).toBeInTheDocument()
    expect(within(first!).getByRole('link')).toHaveAttribute('href', `/treino/${open}`)
    expect(second).toHaveTextContent('12/10/2026')
    expect(within(second!).getByText('Hevy')).toBeInTheDocument()
    expect(second).toHaveTextContent('Treino A (Peito exemplo)')
    expect(within(second!).getByRole('link')).toHaveAttribute('href', `/treino/${HEVY}`)
  })
})

describe('Treino routes', () => {
  const find = (list: RouteObject[], path: string): RouteObject | undefined =>
    list.flatMap((r) => [r, ...(r.children ? [find(r.children, path)].filter((c): c is RouteObject => !!c) : [])]).find((r) => r.path === path)

  it('/treino is the Treino tab and /treino/:id the session', () => {
    expect(find(routes, '/treino')?.element).toEqual(<TrainingPage />)
    expect(find(routes, '/treino/:id')).toBeDefined()
    expect(find(routes, '/treino/exercicio/:id')).toBeDefined()
  })

  it('/treino/historico redirects to /treino', async () => {
    const app = await setupApp(['/treino/historico'])
    const { router } = app.viewRoutes([
      { path: '/treino/historico', element: find(routes, '/treino/historico')!.element },
      { path: '/treino', element: <p>aba treino</p> },
    ])
    expect(await screen.findByText('aba treino')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/treino')
  })

  it('/treino/historico/:id redirects to /treino/:id', async () => {
    const app = await setupApp([`/treino/historico/${HEVY}`])
    const { router } = app.viewRoutes([
      { path: '/treino/historico/:id', element: find(routes, '/treino/historico/:id')!.element },
      { path: '/treino/:id', element: <p>sessão</p> },
    ])
    expect(await screen.findByText('sessão')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/treino/${HEVY}`)
  })
})
