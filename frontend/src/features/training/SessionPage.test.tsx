import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adherenceRepo } from '../../data/adherenceRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { mockFetch } from '../../test/fetch-mock'
import { seedSession, seedSet } from '../../test/workoutSeed'
import { setupApp } from '../testSupport'
import { BENCH, PLAN, seedExercises, seedHevySession, seedPastSession, seedPlan } from '../workout/testData'
import { SessionPage } from './SessionPage'
import { TrainingPage } from './TrainingPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0))
  mockFetch({}) // offline
})

const HEVY = '7d1f2a10-0000-5000-8000-00000000f001'

type Db = Awaited<ReturnType<typeof setupApp>>['db']

/** Seeds the plan, then whatever `seed` returns the id of, and opens `/treino/<that id>`. */
async function open(seed: (db: Db) => Promise<string>) {
  const app = await setupApp(['/treino/pending'])
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  const id = await seed(app.db)
  const { router } = app.viewRoutes([
    { path: '/treino', element: <TrainingPage /> },
    { path: '/treino/:id', element: <SessionPage /> },
  ])
  await act(() => router.navigate(`/treino/${id}`))
  return { ...app, id, router, user: userEvent.setup() }
}

describe('SessionPage', () => {
  it('opens a finished app session read-only', async () => {
    await open((db) => seedPastSession(db, '2026-10-11', BENCH, [[80, 10]]))

    expect(await screen.findByRole('heading', { name: 'Treino A' })).toBeInTheDocument()
    expect(screen.getByText('Treino de 11/10')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Supino reto' })).getByRole('listitem')).toHaveTextContent('80 kg × 10')
    expect(screen.queryByText('Hevy')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar treino' })).not.toBeInTheDocument()
  })

  it('an open app session shows "Em andamento" and "Excluir do app" deletes it and goes back to /treino', async () => {
    const { db, id, router, user } = await open(async (db) => {
      const id = await seedSession(db, { date: '2026-10-14', planVersionId: PLAN, dayKey: 'a', startedAt: new Date(2026, 9, 14, 9), endedAt: null })
      await seedSet(db, { sessionId: id, exerciseId: BENCH, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 70, reps: 10, completedAt: new Date(2026, 9, 14, 9, 5) })
      return id
    })

    expect(await screen.findByText('Em andamento')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir do app' }))
    expect(screen.queryByText(/Ele continua no Hevy/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sim, excluir' }))

    expect(await screen.findByText('Treino de 14/10 excluído do app')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/treino')
    expect(await workoutRepo.sessionById(db, id)).toBeNull()
  })

  it('"Excluir do app" on a Hevy session warns it stays in Hevy and clears the day\'s workout mark', async () => {
    const { db, router, user } = await open((db) => seedHevySession(db, HEVY, '2026-10-12', BENCH, [[82.5, 8, 8.5]], 'Peito exemplo'))

    expect(await screen.findByText('Registrado no Hevy. Para corrigir, edite no Hevy.')).toBeInTheDocument()
    expect(screen.getByText('Hevy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir do app' }))
    expect(screen.getByText(/Ele continua no Hevy/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sim, excluir' }))

    expect(await screen.findByText('Treino de 12/10 excluído do app')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/treino')
    expect(await workoutRepo.sessionById(db, HEVY)).toBeNull()
    expect((await adherenceRepo.between(db, '2026-10-12', '2026-10-12')).filter((l) => l.targetType === 'workout' && l.status === 'done')).toEqual([])
  })

  it('shows a Hevy session read-only, with its sets and RPE', async () => {
    await open((db) => seedHevySession(db, HEVY, '2026-10-12', BENCH, [[82.5, 8, 8.5], [82.5, 7]]))

    expect(await screen.findByText('Registrado no Hevy. Para corrigir, edite no Hevy.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    const rows = within(screen.getByRole('region', { name: 'Supino reto' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('82,5 kg × 8')
    expect(rows[0]).toHaveTextContent('RPE 8,5')
    expect(rows[1]).toHaveTextContent('82,5 kg × 7')
    expect(rows[1]).not.toHaveTextContent('RPE')
  })

  it('shows the workout note under the title and each exercise\'s note under it, only when they exist', async () => {
    await open((db) =>
      seedHevySession(db, HEVY, '2026-10-12', BENCH, [[82.5, 8]], 'Peito exemplo', {
        note: 'Descrição de exemplo do treino',
        exerciseNotes: { e1: 'Observação de exemplo do supino' },
      }),
    )

    const header = (await screen.findByRole('heading', { name: 'Treino A (Peito exemplo)' })).closest('header')!
    expect(within(header).getByText('Descrição de exemplo do treino')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Supino reto' })).getByText('Observação de exemplo do supino')).toBeInTheDocument()
  })

  it('without notes, nothing extra shows', async () => {
    await open((db) => seedPastSession(db, '2026-10-11', BENCH, [[80, 10]]))

    const header = (await screen.findByRole('heading', { name: 'Treino A' })).closest('header')!
    expect(header.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Supino reto' }).querySelectorAll('p')).toHaveLength(0)
  })

  it('after "Excluir do app" the deleted session is not in the history (back does not return to it) and the notice is shown once', async () => {
    const { router, user } = await open((db) => seedPastSession(db, '2026-10-11', BENCH, [[80, 10]]))

    await user.click(await screen.findByRole('button', { name: 'Excluir do app' }))
    await user.click(screen.getByRole('button', { name: 'Sim, excluir' }))
    expect(await screen.findByText('Treino de 11/10 excluído do app')).toBeInTheDocument()
    // The notice stays on screen, but the history entry drops it (a reload or coming back does not repeat it).
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(screen.getByText('Treino de 11/10 excluído do app')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/treino')

    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/treino/pending')
  })

  it('an unknown session says so, with a link back to /treino', async () => {
    await open(async () => '7d1f2a10-0000-5000-8000-00000000dead')
    expect(await screen.findByText('Treino não encontrado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para o treino/ })).toHaveAttribute('href', '/treino')
  })
})
