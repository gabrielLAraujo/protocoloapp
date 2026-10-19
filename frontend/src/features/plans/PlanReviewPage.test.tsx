import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

async function renderReview(plan: PlanVersion, extra: Record<string, () => Response> = {}) {
  const calls = mockFetch({ [`GET /api/plans/${PLAN_ID}`]: () => json(plan), ...extra })
  const app = await setupApp([`/planejamento/revisao/${PLAN_ID}`])
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  app.view(
    <Routes>
      <Route path="/planejamento/revisao/:id" element={<PlanReviewPage />} />
      <Route path="/planejamento" element={<p>LISTA DE PLANOS</p>} />
    </Routes>,
  )
  return { ...app, calls, runOnce }
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
    const { calls, runOnce } = await renderReview(
      planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }),
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
    expect(put.newExercises).toEqual([{ name: 'Crucifixo novo', group: 'shoulders' }])
    expect(JSON.parse(writes[1]!.body)).toEqual({ cycleStart: '2026-10-18' })
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('protocol review edits the dates and activates', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    const { calls } = await renderReview(
      planVersion({ kind: 'protocol', document: { ...protocolDocument(), updateDate: undefined }, lowConfidence: ['updateDate'] }),
      {
        [`PUT /api/plans/${PLAN_ID}`]: () => json(planVersion({ kind: 'protocol' })),
        [`POST /api/plans/${PLAN_ID}/activate`]: () => json(planVersion({ kind: 'protocol', status: 'active' })),
      },
    )

    const update = await screen.findByLabelText('Data da próxima atualização')
    expect(update).toHaveValue('')
    expect(screen.getAllByText('Confira')).toHaveLength(1)
    await user.type(update, '2026-12-01')
    await user.type(screen.getByLabelText('Data de cobrança'), '2026-12-05')
    await user.clear(screen.getByLabelText('Fase'))
    await user.type(screen.getByLabelText('Fase'), 'Fase 3')
    await user.click(activate())

    await screen.findByText('LISTA DE PLANOS')
    const put = JSON.parse(calls.find((c) => c.method === 'PUT')!.body) as { document: Record<string, unknown>; newExercises: unknown }
    expect(put.document).toMatchObject({ phaseName: 'Fase 3', updateDate: '2026-12-01', billingDate: '2026-12-05' })
    expect(put.newExercises).toBeNull()
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
    app.view(
      <Routes>
        <Route path="/planejamento/revisao/:id" element={<PlanReviewPage />} />
      </Routes>,
    )

    expect(await screen.findByText('Conecte-se à internet para revisar o plano.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('a plan that is no longer a draft cannot be reviewed', async () => {
    await renderReview(planVersion({ status: 'active' }))
    expect(await screen.findByText('Esta versão não é mais um rascunho.')).toBeInTheDocument()
  })
})

