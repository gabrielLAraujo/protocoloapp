import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { exerciseRepo, exerciseSync } from '../../data/exerciseRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { planVersion, PLAN_ID, protocolDocument, type PlanVersion } from './fixtures'
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

async function renderReview(plan: PlanVersion, extra: Record<string, () => Response> = {}, state: unknown = null) {
  const calls = mockFetch({ [`GET /api/plans/${PLAN_ID}`]: () => json(plan), ...extra })
  const app = await setupApp([{ pathname: `/planejamento/revisao/${PLAN_ID}`, state }])
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
        kind: 'protocol',
        document: protocolDocument(),
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

  it('a draft whose extraction ran out of AI credits says how to top up instead of the generic banner', async () => {
    await renderReview(planVersion({ document: {}, extractionError: 'no_credits' }))
    await screen.findByRole('heading', { level: 2, name: 'Rotação' })

    expect(
      await screen.findByText(
        'A IA está sem créditos. Recarregue em console.anthropic.com → Plans & Billing e tente de novo — ou preencha à mão.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Não consegui ler esse PDF. Você pode preencher à mão.')).not.toBeInTheDocument()
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
      planVersion({ kind: 'protocol', document: protocolDocument(), diff: { added: ['days[c]'], removed: [], changed: [] } }),
      { [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ kind: 'protocol', diff: null })) },
    )
    const list = await screen.findByRole('list', { name: 'Mudanças em relação à versão ativa' })
    expect(within(list).getByText('days[c]')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await screen.findByText('Rascunho salvo')

    expect(within(screen.getByRole('list', { name: 'Mudanças em relação à versão ativa' })).getByText('days[c]')).toBeInTheDocument()
  })

  it('until the catalog is read, a day cannot be confirmed', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    let release: (value: Awaited<ReturnType<typeof exerciseRepo.all>>) => void = () => {}
    vi.spyOn(exerciseRepo, 'all').mockReturnValue(new Promise((resolve) => (release = resolve)))
    await renderReview(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))

    await user.click(await screen.findByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('button', { name: 'Confirmar dia' })).toBeDisabled()

    await act(async () => {
      release([])
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar dia' })).toBeEnabled())
  })

  it('when the catalog cannot be read, shows an error and keeps the day from being confirmed', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(exerciseRepo, 'all').mockRejectedValue(new Error('db closed'))
    await renderReview(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))

    await user.click(await screen.findByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar dia' })).toBeDisabled())
  })

  it('offline: "Ativar" is disabled with the connect message', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderReview(planVersion({ kind: 'protocol', document: protocolDocument() }))

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

  it('saving the draft hides the extraction-error banner', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion({ kind: 'protocol', document: protocolDocument(), extractionError: 'timeout' }), {
      [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ kind: 'protocol', extractionError: 'timeout' })), // the server keeps it
    })
    expect(await screen.findByText('Não consegui ler esse PDF. Você pode preencher à mão.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))

    await screen.findByText('Rascunho salvo')
    expect(screen.queryByText('Não consegui ler esse PDF. Você pode preencher à mão.')).not.toBeInTheDocument()
  })

  it('shows the notice the device import left, until the draft is saved', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const notice = 'Esse PDF não tem texto selecionável. Preencha à mão.'
    await renderReview(planVersion({ kind: 'protocol', document: protocolDocument() }), { [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ kind: 'protocol' })) }, { notice })
    expect(await screen.findByText(notice)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))

    await screen.findByText('Rascunho salvo')
    expect(screen.queryByText(notice)).not.toBeInTheDocument()
  })

  it('without the AI on the server there is no "Ler com IA"', async () => {
    await renderReview(planVersion(), { 'GET /api/plans/extraction': () => json({ ai: false }) })
    await screen.findByRole('heading', { level: 2, name: 'Rotação' })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Ler com IA' })).not.toBeInTheDocument()
  })

  it('"Ler com IA" reads the same file with the AI and opens the new draft', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const NEW_ID = '7d1f2a10-0000-5000-8000-0000000000c9'
    const { calls } = await renderReview(planVersion(), {
      'GET /api/plans/extraction': () => json({ ai: true }),
      'POST /api/plans/import': () => json(planVersion({ id: NEW_ID }), 201),
      [`GET /api/plans/${NEW_ID}`]: () => json(planVersion({ id: NEW_ID, document: { days: [] }, extractionError: 'timeout' })),
    })

    await user.click(await screen.findByRole('button', { name: 'Ler com IA' }))

    expect(await screen.findByText('Não consegui ler esse PDF. Você pode preencher à mão.')).toBeInTheDocument()
    const imported = calls.find((c) => c.path === '/api/plans/import')!
    expect(JSON.parse(imported.body)).toEqual({ fileId: planVersion().sourceFileId, kind: 'workout' })
  })

  it('"Ler com IA" unavailable shows the message and keeps the draft', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await renderReview(planVersion(), {
      'GET /api/plans/extraction': () => json({ ai: true }),
      'POST /api/plans/import': () => problem(503, { title: 'Importação indisponível' }),
    })
    await user.click(await screen.findByRole('button', { name: 'Ler com IA' }))
    expect(await screen.findByText('Importação indisponível no momento.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Rotação' })).toBeInTheDocument()
  })

  it('leaving with unsaved edits asks to discard; staying keeps them; discarding leaves', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { router } = await renderReview(planVersion())
    await user.click(await screen.findByRole('button', { name: 'Adicionar descanso' }))

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
    await screen.findByRole('button', { name: 'Adicionar descanso' })

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Adicionar descanso' }))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('without edits, navigating away is not blocked', async () => {
    const { router } = await renderReview(planVersion())
    await screen.findByRole('heading', { level: 2, name: 'Rotação' })

    await act(() => router.navigate('/planejamento'))

    expect(await screen.findByText('LISTA DE PLANOS')).toBeInTheDocument()
  })
})
