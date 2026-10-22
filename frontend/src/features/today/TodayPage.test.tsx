import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteObject } from 'react-router'
import type { SyncRecord } from '../../data/apiClient'
import { adherenceRepo } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { routes } from '../../routes'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { BENCH, seedExercises, seedPastSession, seedPlan } from '../workout/testData'
import { TodayPage } from './TodayPage'

// Tuesday 2026-10-20. The workout fixtures rotate from 2026-10-18, so with [a, b] today is "a"; with [a, off] it is off.
const TODAY = '2026-10-20'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0))
  mockFetch({}) // offline
})

/** A fictitious protocol: two meals, an item with REF 1, an untimed item and daily cardio. */
const protocolDocument = {
  phaseName: 'Fase teste',
  updateDate: '2026-12-05',
  meals: [
    { key: '1', label: 'REF 1', items: [{ food: 'Ovos', grams: 100, alternatives: ['Claras'] }] },
    { key: '2', label: 'REF 2', items: [{ food: 'Arroz', grams: 150 }] },
  ],
  items: [
    { key: 'creatina', category: 'supplement', name: 'Creatina', doseText: '5 g', timing: 'with_meal:1', schedule: { type: 'daily' } },
    { key: 'vitd', category: 'supplement', name: 'Vitamina D', doseText: '1 cápsula', timing: 'any', schedule: { type: 'daily' } },
  ],
  cardio: { daily: true, durationMin: 30, intensity: 'moderada' },
  guidelines: [],
}

async function seedProtocol(db: LocalDb) {
  const record: SyncRecord = {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000d1',
    version: 1,
    payload: { kind: 'protocol', status: 'active', document: protocolDocument, activated_at: new Date(2026, 9, 15, 12).toISOString(), low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-15T12:00:00.000000+00:00',
  }
  await planVersionSync.applyRemote(db, record)
}

/** Both parts of today's check-in saved. */
async function saveFullCheckin(db: LocalDb, note: string | null) {
  await dailyCheckinRepo.saveMorning(db, USER_A, TODAY, { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }, new Date())
  await dailyCheckinRepo.saveEvening(db, USER_A, TODAY, { energyDay: 3, anxiety: 2, waterL: 3, note }, new Date())
}

async function render(items: string[] = ['a', 'b']) {
  const app = await setupApp()
  await seedExercises(app.db)
  await seedPlan(app.db, items)
  await seedProtocol(app.db)
  const user = userEvent.setup()
  app.view(<TodayPage />)
  await screen.findByRole('list', { name: 'Itens de hoje' })
  return { ...app, user }
}

const row = (name: string) => within(screen.getByRole('listitem', { name }))
const items = () => screen.getByRole('list', { name: 'Itens de hoje' })
/** The rows, in screen order (the outer list's items are the periods). */
const rowNames = () => within(items()).getAllByRole('listitem').filter((li) => li.parentElement !== items()).map((li) => li.getAttribute('aria-label'))
const period = (name: string) => within(items()).getByRole('listitem', { name })
/** Opens a row's sheet through its "⋯" button. */
const openMenu = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(row(name).getByRole('button', { name: `Mais opções para ${name}` }))
const dialog = (name: string) => within(screen.getByRole('dialog', { name }))
const today = (db: LocalDb) => adherenceRepo.between(db, TODAY, TODAY)

describe('TodayPage', () => {
  it('shows the day, the counter and the targets in time order with their details', async () => {
    const { db } = await render()

    expect(screen.getByText('Terça, 20/10 · Dia de treino — A')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 8 feitos')
    expect(rowNames()).toEqual(['Check-in da manhã', 'REF 1', 'Creatina', 'Cardio', 'REF 2', 'Treino A', 'Check-in da noite', 'Vitamina D'])
    // Opening Hoje created the suggested times.
    expect((await scheduleRepo.all(db)).length).toBeGreaterThan(0)
    expect(row('REF 1').getByText('07:00')).toBeInTheDocument()
    expect(row('Vitamina D').getByText('Sem horário')).toBeInTheDocument()

    // By period (nothing falls in Tarde here: the bounds are in todayData.test.ts), the untimed ones last.
    expect(within(items()).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Manhã', 'Noite', 'Sem horário'])
    expect(within(period('Manhã')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Check-in da manhã', 'REF 1', 'Creatina', 'Cardio', 'REF 2'])
    expect(within(period('Sem horário')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Vitamina D'])

    expect(row('Treino A').getByRole('link', { name: 'Treino A' })).toHaveAttribute('href', '/treino')
    expect(row('Check-in da manhã').getByText('07:00')).toBeInTheDocument()
    expect(row('Check-in da noite').getByText('21:30')).toBeInTheDocument()
    expect(row('Check-in da manhã').getByRole('link', { name: 'Check-in da manhã' })).toHaveAttribute('href', '/checkin/manha')
    expect(row('Check-in da noite').getByRole('link', { name: 'Check-in da noite' })).toHaveAttribute('href', '/checkin/noite')
    expect(row('Treino A').queryByRole('button', { name: 'Feito' })).not.toBeInTheDocument()
  })

  it('✓ marks done and tapping it again clears the mark', async () => {
    const { db, user } = await render()
    const done = row('REF 2').getByRole('button', { name: 'Feito' })
    expect(done).toHaveAttribute('aria-pressed', 'false')

    await user.click(done)

    await waitFor(() => expect(row('REF 2').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('status')).toHaveTextContent('1 de 8 feitos')
    expect(await today(db)).toMatchObject([{ targetType: 'meal', targetKey: '2', status: 'done' }])

    await user.click(row('REF 2').getByRole('button', { name: 'Feito' }))

    await waitFor(() => expect(row('REF 2').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('status')).toHaveTextContent('0 de 8 feitos')
    expect(await today(db)).toEqual([])
  })

  it('"⋯" opens the item sheet; Parcial and Não fiz ask for the reason; "Outro" takes an optional note; Cancelar saves nothing', async () => {
    const { db, user } = await render()

    await openMenu(user, 'REF 1')
    // The focus starts on the sheet's title, not on "Parcial" (one Enter would choose it).
    expect(dialog('REF 1').getByRole('heading', { name: 'REF 1' })).toHaveFocus()
    await user.click(dialog('REF 1').getByRole('button', { name: 'Parcial' }))
    await user.click(dialog('Parcial — REF 1').getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await today(db)).toEqual([])

    await openMenu(user, 'REF 1')
    await user.click(dialog('REF 1').getByRole('button', { name: 'Parcial' }))
    await user.click(dialog('Parcial — REF 1').getByRole('button', { name: 'Sem fome' }))
    await waitFor(() => expect(row('REF 1').getByText('Parcial: Sem fome')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 8 feitos · 1 parcial')

    await openMenu(user, 'Creatina')
    await user.click(dialog('Creatina').getByRole('button', { name: 'Não fiz' }))
    const sheet = dialog('Não fiz — Creatina')
    await user.click(sheet.getByRole('button', { name: 'Outro' }))
    await user.type(sheet.getByLabelText('Observação (opcional)'), 'Acabou')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(row('Creatina').getByText('Não fiz: Outro — Acabou')).toBeInTheDocument())
    expect(row('Creatina').getByText('Não fiz', { exact: true })).toBeInTheDocument()
    expect(await today(db)).toMatchObject([
      { targetType: 'meal', targetKey: '1', status: 'partial', reason: 'no_appetite', note: null },
      { targetType: 'protocol_item', targetKey: 'creatina', status: 'missed', reason: 'other', note: 'Acabou' },
    ])

    // The sheet shows the pressed mark; tapping it again clears it.
    await openMenu(user, 'Creatina')
    expect(dialog('Creatina').getByRole('button', { name: 'Não fiz' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(dialog('Creatina').getByRole('button', { name: 'Não fiz' }))
    await waitFor(() => expect(row('Creatina').queryByText('Não fiz', { exact: true })).not.toBeInTheDocument())
    expect(await today(db)).toMatchObject([{ targetKey: '1', status: 'partial' }])
  })

  it('the item sheet lists the foods with their grams, the alternatives and the dose', async () => {
    const { user } = await render()

    // Tapping the name opens it too.
    await user.click(row('REF 1').getByRole('button', { name: 'REF 1' }))
    const details = within(dialog('REF 1').getByRole('list', { name: 'Detalhes' }))
    const food = details.getByText('Ovos').closest('li')!
    expect(within(food).getByText('100 g')).toHaveClass('tabular-nums', 'text-right')
    expect(details.getByText('ou: Claras')).toBeInTheDocument()
    await user.click(dialog('REF 1').getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await openMenu(user, 'Creatina')
    expect(within(dialog('Creatina').getByRole('list', { name: 'Detalhes' })).getByText('5 g')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await openMenu(user, 'Cardio')
    const cardio = within(dialog('Cardio').getByRole('list', { name: 'Detalhes' }))
    expect(cardio.getByText('30 min')).toBeInTheDocument()
    expect(cardio.getByText('moderada')).toBeInTheDocument()
  })

  it('the hero shows the next open task and marks it done', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 7, 10))
    const { db, user } = await render()
    const hero = within(screen.getByRole('region', { name: 'Resumo do dia' }))
    const next = within(hero.getByRole('region', { name: 'Próxima tarefa' }))

    // 07:00 is still on time at 07:10: the morning check-in (a link) comes first.
    expect(next.getByText('Check-in da manhã')).toBeInTheDocument()
    expect(next.getByRole('link', { name: 'Abrir Check-in da manhã' })).toHaveAttribute('href', '/checkin/manha')

    vi.setSystemTime(new Date(2026, 9, 20, 7, 40))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    // Both 07:00 rows are late now: the first one not late yet is Cardio (07:30).
    expect(await next.findByText('Cardio')).toBeInTheDocument()

    vi.setSystemTime(new Date(2026, 9, 20, 10, 0))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await next.findByText('REF 2')).toBeInTheDocument()
    await user.click(next.getByRole('button', { name: 'Marcar REF 2 como feito' }))
    await waitFor(() => expect(row('REF 2').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'true'))
    expect(await today(db)).toMatchObject([{ targetType: 'meal', targetKey: '2', status: 'done' }])
    expect(next.queryByText('REF 2')).not.toBeInTheDocument()
  })

  it('highlights an unmarked target more than 30 minutes past its time', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 7, 25))
    const { user } = await render()
    expect(row('REF 1').queryByText('Atrasado')).not.toBeInTheDocument()

    vi.setSystemTime(new Date(2026, 9, 20, 7, 31))
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(await row('REF 1').findByText('Atrasado')).toBeInTheDocument()
    // Only the chip says it: no red dot, no type icon, and the row itself is not tinted.
    const late = screen.getByRole('listitem', { name: 'REF 1' })
    expect(late.querySelector('[data-late-dot]')).toBeNull()
    expect(late.querySelector('.bg-danger')).toBeNull()
    expect(late.className).not.toMatch(/danger/)
    const chip = row('REF 1').getByText('Atrasado')
    expect(chip).toHaveClass('text-danger', 'bg-surface')
    expect(chip.className).not.toMatch(/bg-danger/)
    expect(row('Creatina').getByText('Atrasado')).toBeInTheDocument()
    expect(row('Cardio').queryByText('Atrasado')).not.toBeInTheDocument() // 07:30 + 30 min
    expect(row('Vitamina D').queryByText('Atrasado')).not.toBeInTheDocument() // no time

    await user.click(row('REF 1').getByRole('button', { name: 'Feito' }))
    await waitFor(() => expect(row('REF 1').queryByText('Atrasado')).not.toBeInTheDocument())
  })

  it('the item sheet closes for good when its row goes away (and does not come back with it)', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'off']) // today (20th) "a", the 21st off
    await planVersionSync.applyRemote(app.db, {
      entity: 'plan_version',
      id: '7d1f2a10-0000-5000-8000-0000000000d1',
      version: 1,
      payload: {
        kind: 'protocol',
        status: 'active',
        document: { ...protocolDocument, items: [{ key: 'pre', category: 'supplement', name: 'Item de treino', timing: 'any', schedule: { type: 'training_days_only' } }] },
        activated_at: new Date(2026, 9, 15, 12).toISOString(),
        low_confidence: [],
      },
      deletedAt: null,
      clientUpdatedAt: '2026-10-15T12:00:00.000000+00:00',
    })
    const user = userEvent.setup()
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })
    await openMenu(user, 'Item de treino')
    expect(screen.getByRole('dialog', { name: 'Item de treino' })).toBeInTheDocument()

    // The next day is a rest day: the row, and with it the sheet, are gone.
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByText('Quarta, 21/10 · Descanso')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Back on the training day the row returns, the sheet does not.
    vi.setSystemTime(new Date(2026, 9, 20, 12, 0))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByRole('listitem', { name: 'Item de treino' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a rest day has no workout row', async () => {
    await render(['a', 'off', 'off'])

    expect(screen.getByText('Terça, 20/10 · Descanso')).toBeInTheDocument()
    expect(rowNames()).not.toContain('Treino A')
    expect(screen.queryByRole('link', { name: /Treino/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 7 feitos')
  })

  it('the workout and both check-in parts show done from a finished session and a full check-in saved', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedProtocol(app.db)
    await seedPastSession(app.db, TODAY, BENCH, [[60, 10]])
    await saveFullCheckin(app.db, null)
    app.view(<TodayPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('3 de 8 feitos')
    expect(row('Treino A').getByText('Feito')).toBeInTheDocument()
    expect(row('Check-in da manhã').getByText('Feito')).toBeInTheDocument()
    expect(row('Check-in da noite').getByText('Feito')).toBeInTheDocument()
  })

  it('a check-in mark from before the split (key checkin) shows the evening part done, not the morning one', async () => {
    const app = await setupApp()
    await seedProtocol(app.db)
    await adherenceRepo.mark(app.db, USER_A, { date: TODAY, targetType: 'checkin', targetKey: 'checkin', status: 'done' }, new Date())
    app.view(<TodayPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('1 de 7 feitos')
    expect(row('Check-in da noite').getByText('Feito')).toBeInTheDocument()
    expect(row('Check-in da manhã').queryByText('Feito')).not.toBeInTheDocument()
  })

  it("marking cardio also answers cardio on today's check-in", async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedProtocol(app.db)
    await saveFullCheckin(app.db, 'Nota')
    const user = userEvent.setup()
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })

    await user.click(row('Cardio').getByRole('button', { name: 'Feito' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Quantos minutos?' })).getByRole('button', { name: 'Pular' }))

    await waitFor(async () => expect(await dailyCheckinRepo.get(app.db, TODAY)).toMatchObject({ cardioDone: true, cardioMinutes: null, note: 'Nota' }))
    expect(await today(app.db)).toMatchObject([{ targetType: 'cardio', status: 'done' }])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('✓ on Cardio asks "Quantos minutos?": the minutes are saved on the check-in and shown in the details', async () => {
    const { db, user } = await render()

    await user.click(row('Cardio').getByRole('button', { name: 'Feito' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Quantos minutos?' }))
    const minutes = sheet.getByLabelText('Minutos de cardio (opcional)')
    expect(minutes).toHaveFocus()

    await user.type(minutes, '301')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))
    expect(sheet.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 0 a 300')
    expect(await today(db)).toEqual([])

    await user.clear(minutes)
    await user.type(minutes, '40')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(row('Cardio').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, TODAY)).toMatchObject({ cardioDone: true, cardioMinutes: 40 })
    expect(await today(db)).toMatchObject([{ targetType: 'cardio', status: 'done' }])
    await openMenu(user, 'Cardio')
    const done = dialog('Cardio').getByText('Feito').closest('li')!
    expect(within(done).getByText('40 min')).toBeInTheDocument()
  })

  it('Escape or Cancelar on "Quantos minutos?" marks nothing; ½ and ✗ on Cardio still ask for the reason', async () => {
    const { db, user } = await render()

    await user.click(row('Cardio').getByRole('button', { name: 'Feito' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await today(db)).toEqual([])

    // "Cancelar" does the same.
    await user.click(row('Cardio').getByRole('button', { name: 'Feito' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Quantos minutos?' })).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await today(db)).toEqual([])
    expect(await dailyCheckinRepo.get(db, TODAY)).toBeNull()

    await openMenu(user, 'Cardio')
    await user.click(dialog('Cardio').getByRole('button', { name: 'Não fiz' }))
    await user.click(dialog('Não fiz — Cardio').getByRole('button', { name: 'Sem tempo' }))
    await waitFor(() => expect(row('Cardio').getByText('Não fiz', { exact: true })).toBeInTheDocument())
    expect(await dailyCheckinRepo.get(db, TODAY)).toMatchObject({ cardioDone: false, cardioMinutes: null })
  })

  it('without a protocol or workout plan still lists the check-in', async () => {
    const app = await setupApp()
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })

    expect(screen.getByText('Terça, 20/10 · Sem ficha de treino')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Check-in da manhã', 'Check-in da noite'])
  })
})

describe('/hoje', () => {
  const find = (list: RouteObject[], path: string): RouteObject | undefined =>
    list.flatMap((r) => [r, ...(r.children ? [find(r.children, path)].filter((c): c is RouteObject => !!c) : [])]).find((r) => r.path === path)

  it('is a signed-in route that renders Hoje (the reminders open it)', async () => {
    const route = find(routes, '/hoje')
    expect(route).toBeDefined()
    const app = await setupApp(['/hoje'])
    app.viewRoutes([{ path: '/hoje', element: route!.element }])

    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Check-in da noite' })).toBeInTheDocument()
  })
})
