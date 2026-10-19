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
const rowNames = () => within(screen.getByRole('list', { name: 'Itens de hoje' })).getAllByRole('listitem').filter((li) => li.parentElement?.getAttribute('aria-label') === 'Itens de hoje').map((li) => li.getAttribute('aria-label'))
const today = (db: LocalDb) => adherenceRepo.between(db, TODAY, TODAY)

describe('TodayPage', () => {
  it('shows the day, the counter and the targets in time order with their details', async () => {
    const { db } = await render()

    expect(screen.getByText('Terça, 20/10 · Dia de treino — A')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 7 feitos')
    expect(rowNames()).toEqual(['REF 1', 'Creatina', 'Cardio', 'REF 2', 'Treino A', 'Check-in do dia', 'Vitamina D'])
    // Opening Hoje created the suggested times.
    expect((await scheduleRepo.all(db)).length).toBeGreaterThan(0)
    expect(row('REF 1').getByText('07:00')).toBeInTheDocument()
    expect(row('Vitamina D').getByText('Sem horário')).toBeInTheDocument()

    expect(row('REF 1').getByText('Ovos — 100 g')).toBeInTheDocument()
    expect(row('REF 1').getByText(/ou: Claras/)).toBeInTheDocument()
    expect(row('Creatina').getByText('Creatina — 5 g')).toBeInTheDocument()
    expect(row('Cardio').getByText('30 min · moderada')).toBeInTheDocument()

    expect(row('Treino A').getByRole('link', { name: 'Treino A' })).toHaveAttribute('href', '/treino')
    expect(row('Check-in do dia').getByRole('link', { name: 'Check-in do dia' })).toHaveAttribute('href', '/checkin')
    expect(row('Treino A').queryByRole('button', { name: 'Feito' })).not.toBeInTheDocument()
  })

  it('✓ marks done and tapping it again clears the mark', async () => {
    const { db, user } = await render()
    const done = row('REF 2').getByRole('button', { name: 'Feito' })
    expect(done).toHaveAttribute('aria-pressed', 'false')

    await user.click(done)

    await waitFor(() => expect(row('REF 2').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('status')).toHaveTextContent('1 de 7 feitos')
    expect(await today(db)).toMatchObject([{ targetType: 'meal', targetKey: '2', status: 'done' }])

    await user.click(row('REF 2').getByRole('button', { name: 'Feito' }))

    await waitFor(() => expect(row('REF 2').getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('status')).toHaveTextContent('0 de 7 feitos')
    expect(await today(db)).toEqual([])
  })

  it('½ and ✗ ask for the reason; "Outro" takes an optional note; Cancelar saves nothing', async () => {
    const { db, user } = await render()

    await user.click(row('REF 1').getByRole('button', { name: 'Parcial' }))
    let sheet = within(screen.getByRole('dialog', { name: 'Parcial — REF 1' }))
    await user.click(sheet.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await today(db)).toEqual([])

    await user.click(row('REF 1').getByRole('button', { name: 'Parcial' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Parcial — REF 1' })).getByRole('button', { name: 'Sem fome' }))
    await waitFor(() => expect(row('REF 1').getByRole('button', { name: 'Parcial' })).toHaveAttribute('aria-pressed', 'true'))
    expect(row('REF 1').getByText('Parcial: Sem fome')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 7 feitos · 1 parcial')

    await user.click(row('Creatina').getByRole('button', { name: 'Não fiz' }))
    sheet = within(screen.getByRole('dialog', { name: 'Não fiz — Creatina' }))
    await user.click(sheet.getByRole('button', { name: 'Outro' }))
    await user.type(sheet.getByLabelText('Observação (opcional)'), 'Acabou')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(row('Creatina').getByRole('button', { name: 'Não fiz' })).toHaveAttribute('aria-pressed', 'true'))
    expect(await today(db)).toMatchObject([
      { targetType: 'meal', targetKey: '1', status: 'partial', reason: 'no_appetite', note: null },
      { targetType: 'protocol_item', targetKey: 'creatina', status: 'missed', reason: 'other', note: 'Acabou' },
    ])
  })

  it('highlights an unmarked target more than 30 minutes past its time', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 7, 25))
    const { user } = await render()
    expect(row('REF 1').queryByText('Atrasado')).not.toBeInTheDocument()

    vi.setSystemTime(new Date(2026, 9, 20, 7, 31))
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(await row('REF 1').findByText('Atrasado')).toBeInTheDocument()
    expect(row('Creatina').getByText('Atrasado')).toBeInTheDocument()
    expect(row('Cardio').queryByText('Atrasado')).not.toBeInTheDocument() // 07:30 + 30 min
    expect(row('Vitamina D').queryByText('Atrasado')).not.toBeInTheDocument() // no time

    await user.click(row('REF 1').getByRole('button', { name: 'Feito' }))
    await waitFor(() => expect(row('REF 1').queryByText('Atrasado')).not.toBeInTheDocument())
  })

  it('a rest day has no workout row', async () => {
    await render(['a', 'off', 'off'])

    expect(screen.getByText('Terça, 20/10 · Descanso')).toBeInTheDocument()
    expect(rowNames()).not.toContain('Treino A')
    expect(screen.queryByRole('link', { name: /Treino/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 6 feitos')
  })

  it('the workout and the check-in show done from a finished session and a saved check-in', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedProtocol(app.db)
    await seedPastSession(app.db, TODAY, BENCH, [[60, 10]])
    await dailyCheckinRepo.upsert(app.db, USER_A, TODAY, {
      sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 3, anxiety: 2, waterL: 3, weightKg: null, note: null, cardioDone: null, cardioMinutes: null,
    }, new Date())
    app.view(<TodayPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('2 de 7 feitos')
    expect(row('Treino A').getByText('Feito')).toBeInTheDocument()
    expect(row('Check-in do dia').getByText('Feito')).toBeInTheDocument()
  })

  it("marking cardio also answers cardio on today's check-in", async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedProtocol(app.db)
    await dailyCheckinRepo.upsert(app.db, USER_A, TODAY, {
      sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 3, anxiety: 2, waterL: 3, weightKg: null, note: 'Nota', cardioDone: null, cardioMinutes: null,
    }, new Date())
    const user = userEvent.setup()
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })

    await user.click(row('Cardio').getByRole('button', { name: 'Feito' }))

    await waitFor(async () => expect(await dailyCheckinRepo.get(app.db, TODAY)).toMatchObject({ cardioDone: true, note: 'Nota' }))
    expect(await today(app.db)).toMatchObject([{ targetType: 'cardio', status: 'done' }])
  })

  it('without a protocol or workout plan still lists the check-in', async () => {
    const app = await setupApp()
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })

    expect(screen.getByText('Terça, 20/10 · Sem ficha de treino')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Check-in do dia'])
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
    expect(await screen.findByRole('link', { name: 'Check-in do dia' })).toBeInTheDocument()
  })
})
