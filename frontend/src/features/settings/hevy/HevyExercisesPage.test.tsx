import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exerciseSync } from '../../../data/exerciseRepo'
import { json, mockFetch, problem, type Handler } from '../../../test/fetch-mock'
import { setupApp } from '../../testSupport'
import type { HevyExerciseLink } from './hevyApi'
import { HevyExercisesPage } from './HevyExercisesPage'

afterEach(() => {
  vi.restoreAllMocks()
})

// Fictitious exercises and links.
const BENCH_ID = '7d1f2a10-0000-5000-8000-0000000000e1'
const SQUAT_ID = '7d1f2a10-0000-5000-8000-0000000000e2'
const PROVISIONAL_ID = '7d1f2a10-0000-5000-8000-0000000000e3'
const ROW_ID = '7d1f2a10-0000-5000-8000-0000000000e4'
const LINK_ID = '5a2b3c40-0000-5000-8000-000000000001'

const exercise = (id: string, name: string) => ({
  entity: 'exercise',
  id,
  version: 1,
  payload: { name, normalized_name: name.toLowerCase(), primary_muscle_group: 'chest', aliases: [] },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

const pending: HevyExerciseLink = {
  id: LINK_ID,
  templateId: 'TPL00001',
  title: 'Supino Exemplo (Barbell)',
  exerciseId: PROVISIONAL_ID,
  exerciseName: 'Supino Exemplo (Barbell)',
  status: 'pending',
  setCount: 4,
}

async function open(links: HevyExerciseLink[], routes: Record<string, Handler> = {}) {
  const calls = mockFetch({
    'GET /api/integrations/hevy/exercises': () => json(links),
    ...routes,
  })
  const app = await setupApp()
  await exerciseSync.applyRemote(app.db, exercise(BENCH_ID, 'Supino exemplo com barra'))
  await exerciseSync.applyRemote(app.db, exercise(SQUAT_ID, 'Agachamento exemplo'))
  await exerciseSync.applyRemote(app.db, exercise(ROW_ID, 'Remada exemplo baixa'))
  // The provisional exercise the server created with the Hevy title.
  await exerciseSync.applyRemote(app.db, exercise(PROVISIONAL_ID, 'Supino Exemplo (Barbell)'))
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  app.view(<HevyExercisesPage />)
  return { ...app, calls, runOnce }
}

const confirmed = (exerciseId: string, exerciseName: string): HevyExerciseLink => ({ ...pending, exerciseId, exerciseName, status: 'confirmed' })

describe('HevyExercisesPage', () => {
  it('shows the title, the set count and the suggestion already selected', async () => {
    const { calls } = await open([pending])

    const item = await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })
    expect(within(item).getByText('4 séries')).toBeInTheDocument()
    await waitFor(() => expect(within(item).getByLabelText('Exercício no app')).toHaveDisplayValue('Supino exemplo com barra'))
    expect(calls.find((c) => c.method === 'GET')!.path).toBe('/api/integrations/hevy/exercises?all=false')
  })

  it('"Confirmar" sends the chosen exercise, removes the item and syncs the device only (the server already moved the sets)', async () => {
    const { calls, runOnce } = await open([pending], {
      [`PUT /api/integrations/hevy/exercises/${LINK_ID}`]: () => json(confirmed(BENCH_ID, 'Supino exemplo com barra')),
    })

    const item = await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })
    await waitFor(() => expect(within(item).getByLabelText('Exercício no app')).toHaveDisplayValue('Supino exemplo com barra'))
    await userEvent.click(within(item).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Nenhum exercício para confirmar.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Supino Exemplo (Barbell)' })).not.toBeInTheDocument()
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ exerciseId: BENCH_ID })
    await waitFor(() => expect(runOnce).toHaveBeenCalledWith({ ignoreBackoff: true }))
    expect(calls.some((c) => c.path === '/api/integrations/hevy/sync')).toBe(false)
  })

  it('another exercise can be picked, after a search', async () => {
    const { calls } = await open([pending], {
      [`PUT /api/integrations/hevy/exercises/${LINK_ID}`]: () => json(confirmed(SQUAT_ID, 'Agachamento exemplo')),
    })

    const item = await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })
    await userEvent.type(within(item).getByRole('searchbox', { name: 'Buscar exercício' }), 'agacha')
    const select = within(item).getByLabelText('Exercício no app')
    expect(within(select).queryByRole('option', { name: 'Remada exemplo baixa' })).not.toBeInTheDocument()
    await userEvent.selectOptions(select, 'Agachamento exemplo')
    await userEvent.click(within(item).getByRole('button', { name: 'Confirmar' }))

    await screen.findByText('Nenhum exercício para confirmar.')
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ exerciseId: SQUAT_ID })
  })

  it('"Manter como exercício novo" confirms with null', async () => {
    const { calls } = await open([pending], {
      [`PUT /api/integrations/hevy/exercises/${LINK_ID}`]: () => json({ ...pending, status: 'confirmed' }),
    })

    const item = await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })
    const select = within(item).getByLabelText('Exercício no app')
    await waitFor(() => expect(select).toHaveDisplayValue('Supino exemplo com barra'))
    await userEvent.selectOptions(select, 'Manter como exercício novo')
    await userEvent.click(within(item).getByRole('button', { name: 'Confirmar' }))

    await screen.findByText('Nenhum exercício para confirmar.')
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ exerciseId: null })
  })

  it('without a suggestion, "Manter como exercício novo" is selected and the provisional exercise is not offered', async () => {
    await open([{ ...pending, title: 'Remada Fictícia (Cable)', exerciseName: 'Remada Fictícia (Cable)' }])

    const item = await screen.findByRole('group', { name: 'Remada Fictícia (Cable)' })
    const select = within(item).getByLabelText('Exercício no app')
    expect(select).toHaveDisplayValue('Manter como exercício novo')
    expect(within(select).queryByRole('option', { name: 'Supino Exemplo (Barbell)' })).not.toBeInTheDocument()
  })

  it('a failed confirmation keeps the item and says why', async () => {
    await open([pending], {
      [`PUT /api/integrations/hevy/exercises/${LINK_ID}`]: () => problem(404, { title: 'Não encontrado', detail: 'Exercício não encontrado.' }),
    })

    const item = await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })
    await userEvent.click(within(item).getByRole('button', { name: 'Confirmar' }))

    expect(await within(item).findByRole('alert')).toHaveTextContent('Exercício não encontrado.')
    expect(screen.getByRole('group', { name: 'Supino Exemplo (Barbell)' })).toBeInTheDocument()
  })

  it('empty list → says there is nothing to confirm', async () => {
    await open([])

    expect(await screen.findByText('Nenhum exercício para confirmar.')).toBeInTheDocument()
  })

  it('"Ver todos" reads every link, with the current exercise selected', async () => {
    const auto = { ...confirmed(SQUAT_ID, 'Agachamento exemplo'), id: '5a2b3c40-0000-5000-8000-000000000002', title: 'Agachamento Exemplo', status: 'auto' as const }
    const { calls } = await open([], {
      'GET /api/integrations/hevy/exercises': (call) => json(call.path.endsWith('all=true') ? [auto] : []),
    })

    await screen.findByText('Nenhum exercício para confirmar.')
    await userEvent.click(screen.getByRole('button', { name: 'Ver todos' }))

    const item = await screen.findByRole('group', { name: 'Agachamento Exemplo' })
    expect(within(item).getByLabelText('Exercício no app')).toHaveDisplayValue('Agachamento exemplo')
    expect(calls.some((c) => c.path === '/api/integrations/hevy/exercises?all=true')).toBe(true)
  })

  it('offline: says it needs a connection and calls nothing', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { calls } = await open([pending])

    expect(await screen.findByText(/precisa de internet/)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.startsWith('/api/integrations'))).toHaveLength(0)
  })

  it('says when the list cannot be read, and tries again', async () => {
    let fail = true
    await open([], {
      'GET /api/integrations/hevy/exercises': () => (fail ? problem(500, { title: 'Erro' }) : json([pending])),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor. Tente de novo.')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('group', { name: 'Supino Exemplo (Barbell)' })).toBeInTheDocument()
  })
})
