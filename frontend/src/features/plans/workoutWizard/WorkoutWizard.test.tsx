import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json } from '../../../test/fetch-mock'
import { planVersion, PLAN_ID, workoutDocument } from '../fixtures'
import { renderReview, SUPINO_ID } from './reviewHarness'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 22, 30))
  sessionStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const user = () => userEvent.setup({ advanceTimers: () => undefined })
const rail = () => within(screen.getByRole('navigation', { name: 'Etapas da revisão' }))
const dot = (n: number) => rail().getByRole('button', { name: new RegExp(`^Etapa ${n} de`) })
const stepTitle = () => screen.getByRole('heading', { level: 2 }).textContent
const next = (u: ReturnType<typeof user>, name: string) => u.click(screen.getByRole('button', { name }))
const row = (name: string) => screen.getByRole('button', { name: `Editar ${name}` }).closest('li')!
const putBodies = (calls: { method: string; body: string }[]) =>
  calls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body) as { document: ReturnType<typeof workoutDocument> & { days: { exercises: Record<string, unknown>[] }[] }; newExercises: unknown })

/** Opens the review on the fixture draft and waits for the first step. */
async function open(plan = planVersion(), extra: Record<string, () => Response> = {}) {
  const view = await renderReview(plan, extra)
  await screen.findByRole('heading', { level: 2, name: 'Rotação' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled())
  return view
}

describe('workout review wizard', () => {
  it('walks Rotação, one step per day, Exercícios novos and Ativar, with dots that only open what was reached', async () => {
    const u = user()
    await open()

    expect(stepTitle()).toBe('Rotação')
    expect(screen.getByText('Etapa 1 de 5')).toBeInTheDocument()
    expect(rail().getAllByRole('button')).toHaveLength(5)
    expect(dot(1)).toHaveAttribute('aria-current', 'step')
    expect(dot(2)).toBeEnabled() // the first day still open
    expect(dot(3)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled()

    await next(u, 'Continuar')
    expect(stepTitle()).toBe('Dia A — Treino A')
    expect(dot(2)).toHaveAttribute('aria-current', 'step')
    expect(dot(3)).toBeDisabled()
    expect(dot(1)).toBeEnabled()

    await u.click(dot(1))
    expect(stepTitle()).toBe('Rotação')
    await u.click(screen.getByRole('button', { name: 'Continuar' }))
    await u.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(stepTitle()).toBe('Rotação')
  })

  it('"Confirmar dia" saves the draft, marks the dot and moves to the next day', async () => {
    const u = user()
    const { calls } = await open()
    await next(u, 'Continuar')

    await next(u, 'Confirmar dia')

    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))
    expect(putBodies(calls)).toHaveLength(1)
    expect(dot(2)).toHaveAccessibleName(/confirmada/)
    expect(dot(3)).toBeEnabled() // up to the first day still open
    expect(dot(4)).toBeDisabled()
    expect(JSON.parse(sessionStorage.getItem(`plan-wizard-confirmed:${PLAN_ID}`)!)).toEqual(['a'])
    // A confirmed day shows "Próximo" when visited again.
    await u.click(dot(2))
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument()
  })

  it('a reopened draft starts at the first day that is not confirmed', async () => {
    sessionStorage.setItem(`plan-wizard-confirmed:${PLAN_ID}`, JSON.stringify(['a', 'gone']))
    await renderReview(planVersion())
    expect(await screen.findByRole('heading', { level: 2, name: 'Dia B — Treino B' })).toBeInTheDocument()
    expect(dot(2)).toHaveAccessibleName(/confirmada/)
  })

  it('going back keeps what was edited on every step, and "Ativar" waits for every day to be confirmed', async () => {
    const u = user()
    await open()

    // Rotação: one more rest day.
    await u.click(screen.getByRole('button', { name: 'Adicionar descanso' }))
    expect(screen.getByLabelText('Posição 4')).toHaveValue('off')
    await next(u, 'Continuar')
    // Dia A: rename the day and the first exercise's reps.
    const name = screen.getByLabelText('Nome do dia')
    await u.clear(name)
    await u.type(name, 'Peito')
    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    const sheet = within(screen.getByRole('dialog'))
    await u.clear(sheet.getByLabelText('Máx.'))
    await u.type(sheet.getByLabelText('Máx.'), '12')
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))

    // Back to the start and forward again: nothing was lost.
    await u.click(dot(1))
    expect(screen.getByLabelText('Posição 4')).toHaveValue('off')
    await u.click(dot(2))
    expect(stepTitle()).toBe('Dia A — Peito')
    expect(within(row('Supino reto')).getByText('1× 8–12')).toBeInTheDocument()

    // Day B is still open: the later dots stay closed.
    expect(dot(4)).toBeDisabled()
    expect(dot(5)).toBeDisabled()
    await u.click(dot(3))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Exercícios novos'))
    expect(dot(5)).toBeEnabled()
    await next(u, 'Continuar')
    expect(stepTitle()).toBe('Ativar')
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeEnabled()
    expect(screen.getByText('Todos os dias foram confirmados.')).toBeInTheDocument()

    // A day added later is not confirmed: the way to Ativar closes again.
    await u.click(dot(1))
    await u.click(screen.getByRole('button', { name: 'Adicionar dia' }))
    expect(rail().getAllByRole('button')).toHaveLength(6)
    expect(rail().getByRole('button', { name: /^Etapa 6 de 6/ })).toBeDisabled()
  })

  it('the summary counts days, exercises, new ones and the "Confira" still to review', async () => {
    const u = user()
    await open(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }], lowConfidence: ['days[1].exercises[0].sets'] }))
    await next(u, 'Continuar')
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Exercícios novos'))
    await next(u, 'Continuar')

    const summary = within(screen.getByLabelText('Resumo do treino'))
    const stat = (label: string) => summary.getByText(label).parentElement!.textContent
    expect(stat('dias')).toBe('dias2')
    expect(stat('exercícios')).toBe('exercícios3')
    expect(stat('novo')).toBe('novo1')
    expect(stat('para conferir')).toBe('para conferir0')
  })

  it('shows each exercise as a compact row: sets, pyramid with drop, technique tags with their explanation', async () => {
    const u = user()
    const doc = workoutDocument()
    doc.days[0]!.exercises[0] = {
      key: 'e1',
      name: 'Supino reto',
      sets: [
        { repsMin: 15, repsMax: 20 },
        { repsMin: 10, repsMax: 15 },
        { repsMin: 8, repsMax: 12, drops: 1 },
      ],
      restSeconds: 90,
      techniques: [{ type: 'drop', count: 1, sets: 'last' }, { type: 'peak', seconds: 2 }],
    } as never
    doc.days[0]!.exercises[1]!.sets = [1, 2, 3, 4].map(() => ({ repsMin: 10, repsMax: 15 }))
    await open(planVersion({ document: doc }))
    await next(u, 'Continuar')

    expect(within(row('Supino reto')).getByText('15-20 · 10-15 · 8-12 +drop')).toBeInTheDocument()
    expect(within(row('Crucifixo novo')).getByText('4× 10–15')).toBeInTheDocument()
    const tag = within(row('Supino reto')).getByRole('button', { name: 'Pico de contração' })
    expect(tag).toHaveAttribute('aria-expanded', 'false')
    await u.click(tag)
    expect(within(row('Supino reto')).getByRole('note')).toHaveTextContent('Segure a contração por 2 s no ponto de maior tensão.')
    await u.click(tag)
    expect(within(row('Supino reto')).queryByRole('note')).not.toBeInTheDocument()
  })

  it('marks "Confira" on the exercises the reading flagged, and says which fields', async () => {
    const u = user()
    await open(planVersion({ lowConfidence: ['days[0].exercises[1].sets', 'days[0].exercises[1].restSeconds'] }))
    await next(u, 'Continuar')

    expect(row('Crucifixo novo')).toHaveAttribute('data-low', 'true')
    expect(within(row('Crucifixo novo')).getByText('Confira')).toBeInTheDocument()
    expect(within(row('Crucifixo novo')).getByText('Confira: séries, descanso')).toBeInTheDocument()
    expect(row('Supino reto')).not.toHaveAttribute('data-low')
    expect(within(row('Supino reto')).queryByText('Confira')).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Editar Crucifixo novo' }))
    expect(within(screen.getByRole('dialog')).getAllByText('Confira').length).toBeGreaterThan(0)
  })

  it('editing sets and techniques in the sheet updates the plan that is saved', async () => {
    const u = user()
    const { calls } = await open()
    await next(u, 'Continuar')

    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    const sheet = within(screen.getByRole('dialog'))
    await u.click(sheet.getByRole('button', { name: 'Adicionar série' }))
    const second = within(sheet.getByRole('group', { name: 'Série 2' }))
    await u.clear(second.getByLabelText('Drops depois'))
    await u.type(second.getByLabelText('Drops depois'), '2')
    await u.selectOptions(sheet.getByLabelText('Adicionar técnica'), 'drop')
    const drop = within(sheet.getByRole('group', { name: 'Técnica Drop' }))
    await u.clear(drop.getByLabelText('Quantidade de drops'))
    await u.type(drop.getByLabelText('Quantidade de drops'), '2')
    await u.selectOptions(drop.getByLabelText('Séries com drop'), 'all')
    await u.selectOptions(sheet.getByLabelText('Adicionar técnica'), 'peak')
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))

    const card = within(row('Supino reto'))
    expect(card.getByText('8–10 · 8–10 +2 drops'.replace('8–10 · 8–10', '8-10 · 8-10'))).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Drop' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Pico de contração' })).toBeInTheDocument()

    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    const saved = putBodies(calls)[0]!.document.days[0]!.exercises[0]!
    expect(saved.sets).toEqual([{ repsMin: 8, repsMax: 10 }, { repsMin: 8, repsMax: 10, drops: 2 }])
    expect(saved.techniques).toEqual([{ type: 'drop', count: 2, sets: 'all' }, { type: 'peak', seconds: 2 }])
  })

  it('an invalid technique value shows its error, and the day cannot be confirmed until it is fixed', async () => {
    const u = user()
    const { calls } = await open()
    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    const sheet = within(screen.getByRole('dialog'))

    await u.selectOptions(sheet.getByLabelText('Adicionar técnica'), 'isometric')
    await u.clear(sheet.getByLabelText('Segundos'))
    expect(sheet.getByText('Obrigatório.')).toBeInTheDocument()
    await u.type(sheet.getByLabelText('Segundos'), '500')
    expect(sheet.getByText('Valor fora da faixa.')).toBeInTheDocument()
    await u.clear(sheet.getByLabelText('Máx.'))
    expect(sheet.getByText('Obrigatório')).toBeInTheDocument()
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))

    expect(screen.getByRole('button', { name: 'Confirmar dia' })).toBeDisabled()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)

    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    const again = within(screen.getByRole('dialog'))
    await u.clear(again.getByLabelText('Segundos'))
    await u.type(again.getByLabelText('Segundos'), '30')
    await u.type(again.getByLabelText('Máx.'), '10')
    await u.click(again.getByRole('button', { name: 'Concluído' }))
    expect(screen.getByRole('button', { name: 'Confirmar dia' })).toBeEnabled()
  })

  it('choosing one of the user\'s exercises sets exerciseId and keeps the name from the PDF', async () => {
    const u = user()
    const { calls } = await open(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))
    await next(u, 'Continuar')

    await u.click(screen.getByRole('button', { name: 'Editar Crucifixo novo' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('Novo exercício')).toBeInTheDocument()
    await u.click(sheet.getByRole('button', { name: 'Escolher par' }))
    const picker = within(screen.getByRole('dialog'))
    const search = picker.getByLabelText('Buscar exercício')
    await u.clear(search)
    await u.type(search, 'supino')
    await u.click(await picker.findByRole('button', { name: 'Seu exercício: Supino reto' }))

    const back = within(screen.getByRole('dialog'))
    expect(back.getByText('Seu exercício')).toBeInTheDocument()
    expect(back.getByLabelText('Nome na ficha')).toHaveValue('Crucifixo novo')
    await u.click(back.getByRole('button', { name: 'Concluído' }))
    expect(within(row('Crucifixo novo')).getByText('no app: Supino reto')).toBeInTheDocument()

    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    const body = putBodies(calls)[0]!
    expect(body.document.days[0]!.exercises[1]).toMatchObject({ name: 'Crucifixo novo', exerciseId: SUPINO_ID })
    expect(body.newExercises).toEqual([]) // no longer new
    expect(body.document.days[0]!.exercises[1]!.aliasConfirmed).toBe(true) // activation may learn the PDF name
  })

  it('choosing a catalog item for a new exercise sets its catalogId, with the GIF in the search results', async () => {
    const u = user()
    const { calls } = await open(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))
    await next(u, 'Continuar')

    await u.click(screen.getByRole('button', { name: 'Editar Crucifixo novo' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Escolher par' }))
    const picker = within(screen.getByRole('dialog'))
    const search = picker.getByLabelText('Buscar exercício')
    await u.clear(search)
    await u.type(search, 'dumbbell fly')
    const result = await picker.findByRole('button', { name: 'Catálogo: invented dumbbell fly' })
    expect(result.querySelector('img')).toHaveAttribute('src', 'https://static.exercisedb.dev/media/fly.gif')
    await u.click(result)

    expect(within(screen.getByRole('dialog')).getByText('Par no catálogo: invented dumbbell fly')).toBeInTheDocument()
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    expect(putBodies(calls)[0]!.newExercises).toEqual([{ name: 'Crucifixo novo', group: 'chest', catalogId: 'cat-fly' }])
  })

  it('"Exercícios novos" sets the group and the pair of each new exercise; without new exercises there is no such step', async () => {
    const u = user()
    const { calls } = await open(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest' }] }))
    await next(u, 'Continuar')
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Exercícios novos'))

    await u.selectOptions(screen.getByLabelText('Grupo de Crucifixo novo'), 'shoulders')
    await u.click(screen.getByRole('button', { name: 'Escolher par de Crucifixo novo' }))
    const picker = within(screen.getByRole('dialog'))
    await u.clear(picker.getByLabelText('Buscar exercício'))
    await u.type(picker.getByLabelText('Buscar exercício'), 'cable row')
    await u.click(await picker.findByRole('button', { name: 'Catálogo: invented cable row' }))
    expect(screen.getByText('Par: invented cable row')).toBeInTheDocument()

    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await screen.findByText('Rascunho salvo')
    expect(putBodies(calls).at(-1)!.newExercises).toEqual([{ name: 'Crucifixo novo', group: 'shoulders', catalogId: 'cat-row' }])
  })

  it('without exercises that are new, the steps are Rotação, the days and Ativar', async () => {
    await open(planVersion({ document: { ...workoutDocument(), days: [workoutDocument().days[1]!] } }))
    expect(rail().getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText('Etapa 1 de 3')).toBeInTheDocument()
  })

  it('activating saves the last edits, then activates and triggers a sync', async () => {
    const u = user()
    const doc = { ...workoutDocument(), days: [workoutDocument().days[1]!], rotation: { type: 'sequence', items: ['b', 'off'] } }
    const { calls, runOnce } = await open(planVersion({ document: doc }), {
      [`POST /api/plans/${PLAN_ID}/activate`]: () => json(planVersion({ status: 'active' })),
    })
    await next(u, 'Continuar')
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Ativar'))

    await u.click(screen.getByRole('button', { name: 'Ativar' }))

    expect(await screen.findByText('LISTA DE PLANOS')).toBeInTheDocument()
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/plans/${PLAN_ID}`,
      `PUT /api/plans/${PLAN_ID}`,
      `POST /api/plans/${PLAN_ID}/activate`,
    ])
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('a rotation that uses a day that does not exist shows the message and blocks Ativar', async () => {
    const u = user()
    const doc = { ...workoutDocument(), rotation: { type: 'sequence', items: ['a', 'z', 'off'] } }
    await open(planVersion({ document: doc }))

    expect(screen.getByText('A rotação usa um dia que não existe')).toBeInTheDocument()
    expect(screen.getByLabelText('Posição 2')).toBeInvalid()
    await u.selectOptions(screen.getByLabelText('Posição 2'), 'b')
    expect(screen.queryByText('A rotação usa um dia que não existe')).not.toBeInTheDocument()
  })

  it('an empty draft starts at Rotação and cannot be activated until a day is filled in', async () => {
    const u = user()
    await open(planVersion({ document: {}, extractionError: 'timeout' }))
    expect(screen.getByText('Não consegui ler esse PDF. Você pode preencher à mão.')).toBeInTheDocument()

    await next(u, 'Continuar')
    expect(stepTitle()).toBe('Ativar')
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeDisabled()
    expect(screen.getByText('Informe ao menos um dia de treino.')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Voltar' }))
    await u.click(screen.getByRole('button', { name: 'Adicionar dia' }))
    await next(u, 'Continuar')
    expect(stepTitle()).toBe('Dia A — Treino 1')
    expect(screen.getByText('Este dia ainda não tem exercícios.')).toBeInTheDocument()
  })

  it('a day can get a new exercise, opened in the sheet, and its group appears once it has a name', async () => {
    const u = user()
    await open()
    await u.click(dot(1))
    await next(u, 'Continuar')
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))

    await u.click(screen.getByRole('button', { name: 'Adicionar exercício' }))
    const sheet = within(screen.getByRole('dialog'))
    await u.type(sheet.getByLabelText('Nome na ficha'), 'Remada baixa')
    expect(sheet.getByLabelText('Grupo de Remada baixa')).toHaveValue('other')
    expect(sheet.getByText('Novo exercício')).toBeInTheDocument()
  })

  it('offline, a day is confirmed on the device without saving', async () => {
    const u = user()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { calls } = await open()
    await next(u, 'Continuar')

    await next(u, 'Confirmar dia')

    await waitFor(() => expect(stepTitle()).toBe('Dia B — Treino B'))
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('a failed save keeps the day open and shows what the server said', async () => {
    const u = user()
    const { problem } = await import('../../../test/fetch-mock')
    await open(planVersion(), { [`PUT /api/plans/${PLAN_ID}`]: () => problem(400, { title: 'Dados inválidos', errors: { 'days[0].name': ['Obrigatório.'] } }) })
    await next(u, 'Continuar')

    await next(u, 'Confirmar dia')

    expect(await screen.findByRole('alert')).toHaveTextContent('days[0].name: Obrigatório.')
    expect(stepTitle()).toBe('Dia A — Treino A')
    expect(dot(2)).not.toHaveAccessibleName(/confirmada/)
  })

  it('renaming an exercise drops the demonstration it had', async () => {
    const u = user()
    const { calls } = await open(planVersion({ newExercises: [{ name: 'Crucifixo novo', group: 'chest', catalogId: 'cat-fly' }] }))
    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Editar Crucifixo novo' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(await sheet.findByText('Par no catálogo: invented dumbbell fly')).toBeInTheDocument()

    const name = sheet.getByLabelText('Nome na ficha')
    await u.clear(name)
    await u.type(name, 'Zzz inventado')

    expect(sheet.getByText('Sem par no catálogo: sem demonstração.')).toBeInTheDocument()
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    expect(putBodies(calls)[0]!.newExercises).toEqual([{ name: 'Zzz inventado', group: 'chest' }])
  })

  it('accepting a flagged exercise that points to one of the user\'s marks the link as confirmed', async () => {
    const u = user()
    const doc = workoutDocument()
    ;(doc.days[0]!.exercises[0] as Record<string, unknown>).exerciseId = SUPINO_ID
    const { calls } = await open(planVersion({ document: doc, lowConfidence: ['days[0].exercises[0].name'] }))
    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    expect(putBodies(calls)[0]!.document.days[0]!.exercises[0]).toMatchObject({ exerciseId: SUPINO_ID, aliasConfirmed: true })
  })

  it('an exercise linked to one of the user\'s gets its pair on the planned exercise, and a rename drops that pair', async () => {
    const u = user()
    const doc = workoutDocument()
    ;(doc.days[0]!.exercises[0] as Record<string, unknown>).exerciseId = SUPINO_ID
    const { calls } = await open(planVersion({ document: doc }))
    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Trocar' }))
    const picker = within(screen.getByRole('dialog'))
    await u.clear(picker.getByLabelText('Buscar exercício'))
    await u.type(picker.getByLabelText('Buscar exercício'), 'dumbbell fly')
    await u.click(await picker.findByRole('button', { name: 'Catálogo: invented dumbbell fly' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('Seu exercício')).toBeInTheDocument()
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    expect(putBodies(calls)[0]!.document.days[0]!.exercises[0]).toMatchObject({ exerciseId: SUPINO_ID, catalogId: 'cat-fly' })
  })

  it('renaming a linked exercise drops the pair its planned exercise carried', async () => {
    const u = user()
    const doc = workoutDocument()
    Object.assign(doc.days[0]!.exercises[0]!, { exerciseId: SUPINO_ID, catalogId: 'cat-fly' })
    const { calls } = await open(planVersion({ document: doc }))
    await next(u, 'Continuar')
    await u.click(screen.getByRole('button', { name: 'Editar Supino reto' }))
    const sheet = within(screen.getByRole('dialog'))
    await u.clear(sheet.getByLabelText('Nome na ficha'))
    await u.type(sheet.getByLabelText('Nome na ficha'), 'Zzz inventado')
    await u.click(sheet.getByRole('button', { name: 'Concluído' }))
    await next(u, 'Confirmar dia')
    await waitFor(() => expect(putBodies(calls)).toHaveLength(1))
    const saved = putBodies(calls)[0]!.document.days[0]!.exercises[0]!
    expect(saved).toMatchObject({ name: 'Zzz inventado', exerciseId: SUPINO_ID })
    expect(saved.catalogId).toBeUndefined()
  })
})
