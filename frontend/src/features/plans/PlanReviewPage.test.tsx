import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { exerciseRepo, exerciseSync } from '../../data/exerciseRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { planVersion, PLAN_ID, protocolDocument, workoutDocument, type PlanVersion } from './fixtures'
import { PlanReviewPage } from './PlanReviewPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 22, 30))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const knownExercise = (id: string, name: string, normalized: string) => ({
  entity: 'exercise',
  id,
  version: 1,
  payload: { name, normalized_name: normalized, primary_muscle_group: 'chest', aliases: [] },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

async function renderReview(plan: PlanVersion, extra: Record<string, () => Response> = {}) {
  const calls = mockFetch({ [`GET /api/plans/${PLAN_ID}`]: () => json(plan), ...extra })
  const app = await setupApp([`/planejamento/revisao/${PLAN_ID}`])
  // The catalog on the device knows the exercises of the fixture except "Crucifixo novo".
  await exerciseSync.applyRemote(app.db, knownExercise('7d1f2a10-0000-5000-8000-0000000000e1', 'Supino reto', 'supino reto'))
  await exerciseSync.applyRemote(app.db, knownExercise('7d1f2a10-0000-5000-8000-0000000000e2', 'Agachamento', 'agachamento'))
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  const view = app.viewRoutes([
    { path: '/planejamento/revisao/:id', element: <PlanReviewPage /> },
    { path: '/planejamento', element: <p>LISTA DE PLANOS</p> },
  ])
  return { ...app, ...view, calls, runOnce }
}

const activate = () => screen.getByRole('button', { name: 'Ativar' })

describe('PlanReviewPage', () => {
  it('shows the diff against the active version', async () => {
    await renderReview(
      planVersion({
        diff: { added: ['days[c]'], removed: ['days[z]'], changed: [{ path: 'days[a].name', before: 'Treino A', after: 'Treino AA' }] },
      }),
    )

    const list = await screen.findByRole('list', { name: 'Mudanças em relação à versão ativa' })
    expect(within(list).getByText('days[c]')).toBeInTheDocument()
    expect(within(list).getByText('days[z]')).toBeInTheDocument()
    expect(within(list).getByText('days[a].name')).toBeInTheDocument()
    expect(within(list).getByText(/Treino A/)).toBeInTheDocument()
    expect(within(list).getByText('Adicionado:')).toBeInTheDocument()
  })

  it('marks low-confidence fields with "Confira" and only those', async () => {
    await renderReview(planVersion({ lowConfidence: ['days[0].exercises[0].name'] }))
    const day = within(await screen.findByRole('region', { name: 'Dia 1' }))

    const first = within(day.getByRole('region', { name: 'Exercício 1' }))
    expect(within(first.getByLabelText('Nome').parentElement!).getByText('Confira')).toBeInTheDocument()
    expect(first.getByLabelText('Nome')).toHaveClass('border-warn')
    expect(first.getByLabelText('Descanso (s)')).not.toHaveClass('border-warn')
    expect(within(day.getByRole('region', { name: 'Exercício 2' })).queryByText('Confira')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Dia 2' })).queryByText('Confira')).not.toBeInTheDocument()
  })

  it('a rotation that uses a day that does not exist blocks "Ativar" with the message, until fixed', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const doc = { ...workoutDocument(), rotation: { type: 'sequence', items: ['a', 'z', 'off'] } }
    await renderReview(planVersion({ document: doc }))

    expect(await screen.findByText('A rotação usa um dia que não existe')).toBeInTheDocument()
    expect(activate()).toBeDisabled()
    expect(screen.getByLabelText('Posição 2')).toBeInvalid()

    await user.selectOptions(screen.getByLabelText('Posição 2'), 'b')

    expect(screen.queryByText('A rotação usa um dia que não existe')).not.toBeInTheDocument()
    expect(activate()).toBeEnabled()
  })

  it('an empty rotation also blocks "Ativar"', async () => {
    const doc = { ...workoutDocument(), rotation: { type: 'sequence', items: [] } }
    await renderReview(planVersion({ document: doc }))

    expect(await screen.findByText('A rotação não pode ficar vazia.')).toBeInTheDocument()
    expect(activate()).toBeDisabled()
  })

  it('the rotation can be edited: add, rest option and removal', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion())
    await screen.findByLabelText('Posição 1')

    await user.click(screen.getByRole('button', { name: 'Adicionar descanso' }))
    expect(screen.getByLabelText('Posição 4')).toHaveValue('off')
    expect(within(screen.getByLabelText('Posição 4')).getByRole('option', { name: 'Descanso' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover posição 4' }))
    expect(screen.queryByLabelText('Posição 4')).not.toBeInTheDocument()
  })

  it('a draft that could not be read opens with the banner, blocked until filled by hand', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion({ document: {}, extractionError: 'timeout' }))

    expect(await screen.findByText('Não consegui ler esse PDF. Você pode preencher à mão.')).toBeInTheDocument()
    expect(activate()).toBeDisabled()
    expect(screen.getByText('Informe ao menos um dia de treino.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Adicionar dia' }))
    expect(screen.getByRole('region', { name: 'Dia 1' })).toBeInTheDocument()
  })

  it('activating saves the edits, activates with the cycle start and triggers a sync', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls, db, runOnce } = await renderReview(
      planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }], extractionError: 'timeout' }),
      {
        [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion()),
        [`POST /api/plans/${PLAN_ID}/activate`]: () => json(planVersion({ status: 'active' })),
      },
    )
    await screen.findByRole('region', { name: 'Exercícios novos' })

    await user.selectOptions(screen.getByLabelText('Grupo de Crucifixo novo'), 'shoulders')
    const day = within(screen.getByRole('region', { name: 'Dia 1' }))
    const name = within(day.getByRole('region', { name: 'Exercício 1' })).getByLabelText('Nome')
    await user.clear(name)
    await user.type(name, 'Supino inclinado')
    await user.click(activate())

    expect(await screen.findByText('LISTA DE PLANOS')).toBeInTheDocument()
    const writes = calls.filter((c) => c.method !== 'GET')
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /api/plans/${PLAN_ID}`, `POST /api/plans/${PLAN_ID}/activate`])
    const put = JSON.parse(writes[0]!.body) as { document: ReturnType<typeof workoutDocument>; newExercises: unknown }
    expect(put.document.days[0]!.exercises[0]!.name).toBe('Supino inclinado')
    expect(put.newExercises).toEqual([
      { name: 'Supino inclinado', group: 'other' }, // renamed to something the catalog does not know
      { name: 'Crucifixo novo', group: 'shoulders' },
    ])
    expect(JSON.parse(writes[1]!.body)).toEqual({ cycleStart: null }) // only a protocol has a cycle start
    expect(screen.queryByLabelText('Início do ciclo')).not.toBeInTheDocument()
    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(await scheduleRepo.all(db)).toEqual([]) // a workout plan has no schedule of its own
  })

  it('protocol review edits the dates and activates', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls, db, runOnce } = await renderReview(
      planVersion({ kind: 'protocol', document: { ...protocolDocument(), updateDate: undefined }, lowConfidence: ['updateDate'] }),
      {
        [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ kind: 'protocol' })),
        [`POST /api/plans/${PLAN_ID}/activate`]: () => json(planVersion({ kind: 'protocol', status: 'active', document: protocolDocument() })),
      },
    )

    const update = await screen.findByLabelText('Data da próxima atualização')
    expect(update).toHaveValue('')
    expect(screen.getAllByText('Confira')).toHaveLength(1)
    expect(screen.getByLabelText('Início do ciclo')).toHaveValue('2026-10-18')
    await user.type(update, '2026-12-01')
    await user.type(screen.getByLabelText('Data de cobrança'), '2026-12-05')
    await user.clear(screen.getByLabelText('Fase'))
    await user.type(screen.getByLabelText('Fase'), 'Fase 3')
    await user.click(activate())

    await screen.findByText('LISTA DE PLANOS')
    const put = JSON.parse(calls.find((c) => c.method === 'PUT')!.body) as { document: Record<string, unknown>; newExercises: unknown }
    expect(put.document).toMatchObject({ phaseName: 'Fase 3', updateDate: '2026-12-01', billingDate: '2026-12-05' })
    expect(put.newExercises).toBeNull()
    expect(JSON.parse(calls.find((c) => c.path.endsWith('/activate'))!.body)).toEqual({ cycleStart: '2026-10-18' })
    // The meals of the activated protocol get their suggested times before the sync sends them (reminders read them).
    const slots = await scheduleRepo.all(db)
    expect(slots.filter((s) => s.slot === 'meal_m1').map((s) => [s.dayType, s.time])).toEqual([
      ['off', '07:00'],
      ['training', '07:00'],
    ])
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('keeps the diff on screen after saving the draft (the PUT answers without one)', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(
      planVersion({ diff: { added: ['days[c]'], removed: [], changed: [] } }),
      { [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ diff: null })) },
    )
    const list = await screen.findByRole('list', { name: 'Mudanças em relação à versão ativa' })
    expect(within(list).getByText('days[c]')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await screen.findByText('Rascunho salvo')

    expect(within(screen.getByRole('list', { name: 'Mudanças em relação à versão ativa' })).getByText('days[c]')).toBeInTheDocument()
  })

  it('until the catalog is read, the group selectors, "Salvar rascunho" and "Ativar" stay disabled', async () => {
    let release: (value: Awaited<ReturnType<typeof exerciseRepo.all>>) => void = () => {}
    vi.spyOn(exerciseRepo, 'all').mockReturnValue(new Promise((resolve) => (release = resolve)))
    await renderReview(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))

    expect(await screen.findByText('Carregando catálogo…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled()
    expect(screen.getByLabelText('Grupo de Crucifixo novo')).toBeDisabled()

    await act(async () => {
      release([])
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ativar' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled()
    expect(screen.queryByText('Carregando catálogo…')).not.toBeInTheDocument()
  })

  it('when the catalog cannot be read, shows an error and keeps saving and activating disabled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(exerciseRepo, 'all').mockRejectedValue(new Error('db closed'))
    await renderReview(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))

    expect(await screen.findByText('Não foi possível ler o catálogo de exercícios do aparelho.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled()
    expect(screen.getByLabelText('Grupo de Crucifixo novo')).toBeDisabled()
  })

  it('a server validation failure is shown and nothing is activated', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls } = await renderReview(planVersion(), {
      [`PUT /api/plans/${PLAN_ID}`]: () => problem(400, { title: 'Dados inválidos', errors: { 'days[0].name': ['Obrigatório.'] } }),
    })
    await screen.findByRole('button', { name: 'Ativar' })

    await user.click(activate())

    expect(await screen.findByRole('alert')).toHaveTextContent('days[0].name: Obrigatório.')
    expect(calls.some((c) => c.path.endsWith('/activate'))).toBe(false)
    expect(screen.queryByText('LISTA DE PLANOS')).not.toBeInTheDocument()
  })

  it('offline: "Ativar" is disabled with the connect message', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderReview(planVersion())

    expect(await screen.findByText('Conecte-se à internet para ativar')).toBeInTheDocument()
    expect(activate()).toBeDisabled()
  })

  it('without a connection to open the plan, says so and offers to retry', async () => {
    mockFetch({})
    const app = await setupApp([`/planejamento/revisao/${PLAN_ID}`])
    app.viewRoutes([{ path: '/planejamento/revisao/:id', element: <PlanReviewPage /> }])

    expect(await screen.findByText('Conecte-se à internet para revisar o plano.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('a plan that is no longer a draft cannot be reviewed', async () => {
    await renderReview(planVersion({ status: 'active' }))
    expect(await screen.findByText('Esta versão não é mais um rascunho.')).toBeInTheDocument()
  })

  it('the chosen group follows a rename, and an exercise renamed to a known one drops out of the list', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls } = await renderReview(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }), {
      [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion()),
    })
    await user.selectOptions(await screen.findByLabelText('Grupo de Crucifixo novo'), 'shoulders')
    const second = within(within(screen.getByRole('region', { name: 'Dia 1' })).getByRole('region', { name: 'Exercício 2' })).getByLabelText('Nome')

    await user.clear(second)
    await user.type(second, 'Crucifixo máquina')
    expect(screen.getByLabelText('Grupo de Crucifixo máquina')).toHaveValue('shoulders')
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await screen.findByText('Rascunho salvo')

    const put = JSON.parse(calls.find((c) => c.method === 'PUT')!.body) as { newExercises: unknown }
    expect(put.newExercises).toEqual([{ name: 'Crucifixo máquina', group: 'shoulders' }])

    await user.clear(second)
    await user.type(second, 'Agachamento')
    expect(screen.queryByRole('region', { name: 'Exercícios novos' })).not.toBeInTheDocument()
  })

  it('an exercise added by hand gets a group selector once it has a name', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion())
    await screen.findByRole('region', { name: 'Dia 2' })
    expect(screen.queryByRole('region', { name: 'Exercícios novos' })).toBeInTheDocument() // Crucifixo novo (not in the catalog)

    await user.click(within(screen.getByRole('region', { name: 'Dia 2' })).getByRole('button', { name: 'Adicionar exercício' }))
    const added = within(within(screen.getByRole('region', { name: 'Dia 2' })).getByRole('region', { name: 'Exercício 2' }))
    await user.type(added.getByLabelText('Nome'), 'Remada baixa')

    expect(screen.getByLabelText('Grupo de Remada baixa')).toHaveValue('other')
  })

  it('a cleared reps box asks for the value instead of saving 0', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls } = await renderReview(planVersion())
    const set = within(within(await screen.findByRole('region', { name: 'Dia 2' })).getByRole('group', { name: 'Série 1' }))

    await user.clear(set.getByLabelText('Mín.'))

    expect(set.getByText('Obrigatório')).toBeInTheDocument()
    expect(activate()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled()
    expect(set.getByLabelText('Mín.')).toHaveValue('')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('saving the draft hides the extraction-error banner', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion({ extractionError: 'timeout' }), {
      [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ extractionError: 'timeout' })), // the server keeps it
    })
    expect(await screen.findByText('Não consegui ler esse PDF. Você pode preencher à mão.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))

    await screen.findByText('Rascunho salvo')
    expect(screen.queryByText('Não consegui ler esse PDF. Você pode preencher à mão.')).not.toBeInTheDocument()
  })

  it('leaving with unsaved edits asks to discard; staying keeps them; discarding leaves', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { router } = await renderReview(planVersion())
    const day = within(await screen.findByRole('region', { name: 'Dia 1' }))
    await user.type(day.getByLabelText('Nome do dia'), '!')

    await act(() => router.navigate('/planejamento'))
    expect(screen.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Posição 1')).toBeInTheDocument()

    await act(() => router.navigate('/planejamento'))
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(await screen.findByText('LISTA DE PLANOS')).toBeInTheDocument()
  })

  it('without edits, leaving is free; the unload warning only exists while dirty', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion())
    const day = within(await screen.findByRole('region', { name: 'Dia 1' }))

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await user.type(day.getByLabelText('Nome do dia'), '!')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('without edits, navigating away is not blocked', async () => {
    const { router } = await renderReview(planVersion())
    await screen.findByRole('region', { name: 'Dia 1' })

    await act(() => router.navigate('/planejamento'))

    expect(await screen.findByText('LISTA DE PLANOS')).toBeInTheDocument()
  })
})
