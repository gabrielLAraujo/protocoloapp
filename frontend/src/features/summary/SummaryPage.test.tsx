import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { adherenceRepo } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { dietDeviationRepo } from '../../data/dietDeviationRepo'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { json, mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { BENCH, seedExercises, seedPastSession, seedPlan } from '../workout/testData'
import { seedGamificationHistory } from '../achievements/testSeed'
import { loadProgress } from '../progress/progressData'
import { SummaryPage } from './SummaryPage'

// Real loadProgress unless a test makes it fail.
vi.mock('../progress/progressData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../progress/progressData')>()
  return { ...actual, loadProgress: vi.fn(actual.loadProgress) }
})

// Tuesday 2026-10-27; the protocol was activated on the 20th.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 27, 12, 0))
  mockFetch({})
})

async function seedProtocol(db: LocalDb, document: Record<string, unknown>, status = 'active') {
  const record: SyncRecord = {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000d1',
    version: 1,
    payload: { kind: 'protocol', status, document, activated_at: status === 'active' ? new Date(2026, 9, 20, 12).toISOString() : null, low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-20T12:00:00.000000+00:00',
  }
  await planVersionSync.applyRemote(db, record)
}

describe('SummaryPage', () => {
  it('without an active protocol offers the shortcut to import it', async () => {
    const app = await setupApp()
    app.view(<SummaryPage />)
    expect(await screen.findByText('Importe o protocolo para ver o ciclo.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir para o planejamento' })).toHaveAttribute('href', '/planejamento')
  })

  it('a protocol without update date shows an inline form that saves through the API and syncs', async () => {
    const app = await setupApp()
    const id = '7d1f2a10-0000-5000-8000-0000000000d1'
    await seedProtocol(app.db, { phaseName: 'Fase 1' })
    const calls = mockFetch({
      [`PATCH /api/plans/${id}/cycle-dates`]: () => json({ id }),
      'POST /api/sync/push': () => json({ results: [] }),
      'GET /api/sync/pull': () =>
        json({
          records: [
            {
              entity: 'plan_version',
              id,
              version: 2,
              payload: { kind: 'protocol', status: 'active', document: { phaseName: 'Fase 1', updateDate: '2026-12-05', billingDate: '2026-11-05' }, activated_at: new Date(2026, 9, 20, 12).toISOString(), low_confidence: [] },
              deletedAt: null,
              clientUpdatedAt: '2026-10-27T12:00:00.000000+00:00',
            },
          ],
          nextSince: 2,
          hasMore: false,
        }),
    })
    app.view(<SummaryPage />)
    const user = userEvent.setup({ advanceTimers: () => undefined })
    expect(await screen.findByText('Defina a data da próxima atualização')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled() // the update date is required here

    await user.type(screen.getByLabelText('Próxima atualização'), '2026-12-05')
    await user.type(screen.getByLabelText('Mensalidade'), '2026-11-05')
    await user.click(save)

    expect(await screen.findByText('Faltam 39 dias para a atualização')).toBeInTheDocument()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(JSON.parse(patch.body)).toEqual({ updateDate: '2026-12-05', billingDate: '2026-11-05' })
  })

  it('offline, the form says to connect and cannot save', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { phaseName: 'Fase 1' })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    app.view(<SummaryPage />)
    await screen.findByText('Defina a data da próxima atualização')
    expect(screen.getByText('Conecte-se à internet para salvar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('shows the countdown, billing date, stats, calendar with legend and strength', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b']) // sequence from 2026-10-18: a, b, a, b...
    await seedProtocol(app.db, {
      updateDate: '2026-12-05',
      billingDate: '2026-11-05',
      cardio: { daily: true },
      guidelines: [{ kind: 'water_min_l', value: 3 }],
    })
    await seedPastSession(app.db, '2026-10-21', BENCH, [[60, 10]])
    await seedPastSession(app.db, '2026-10-25', BENCH, [[70, 10]])
    const at = new Date(2026, 9, 26, 8)
    await dailyCheckinRepo.saveMorning(app.db, USER_A, '2026-10-26', { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: 82.4 }, at)
    await dailyCheckinRepo.saveEvening(app.db, USER_A, '2026-10-26', { energyDay: 4, anxiety: 2, waterL: 2.5, note: null, stress: 3, mood: 4 }, at)
    await dailyCheckinRepo.setCardio(app.db, USER_A, '2026-10-26', { done: true, minutes: 30 }, at)
    await dailyCheckinRepo.saveMorning(app.db, USER_A, '2026-10-25', { sleepQuality: 3, bowel: 'normal', energyWake: 3, weightKg: 83.1 }, at)
    app.view(<SummaryPage />)

    expect(await screen.findByText('Faltam 39 dias para a atualização')).toBeInTheDocument()
    expect(screen.getByText('05/11')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Andamento do ciclo' })).toBeInTheDocument()

    const stats = screen.getByRole('region', { name: 'Números do ciclo' })
    expect(within(stats).getByText('Treinos').nextSibling).toHaveTextContent('2')
    expect(within(stats).getByText('de 8 previstos')).toBeInTheDocument()
    expect(within(stats).getByText('Cardio').closest('div')).toHaveTextContent('1 de 8')
    expect(within(stats).getByText('Água').nextSibling).toHaveTextContent('2,5 L')
    expect(within(stats).getByText('meta 3 L')).toBeInTheDocument()
    // Label → value pairs of description lists (the E2E reads them as `dl > div` → `dt` → first `dd`).
    const valueOf = (label: string) => {
      const term = within(stats).getByText(label)
      expect(term.tagName).toBe('DT')
      expect(term.closest('dl')).not.toBeNull()
      return term.parentElement!.querySelector('dd')
    }
    expect(valueOf('Treinos')).toHaveTextContent(/^2$/)
    expect(valueOf('Água')).toHaveTextContent(/^2,5 L$/)
    expect(valueOf('Check-ins')).toHaveTextContent(/^1$/)
    expect(valueOf('Sono')).toHaveTextContent(/^3,5$/)
    expect(valueOf('Estresse')).toHaveTextContent(/^3$/)
    expect(within(stats).getByText('média, 0–10')).toBeInTheDocument()
    expect(valueOf('Psicológico')).toHaveTextContent(/^4$/)

    const calendar = screen.getByRole('table', { name: 'Calendário do ciclo' })
    expect(within(calendar).getByRole('cell', { name: /21\/10, treino feito/ })).toHaveTextContent('✓')
    expect(within(calendar).getByRole('cell', { name: /27\/10, hoje/ })).toHaveAttribute('aria-current', 'date')
    expect(within(calendar).getByRole('cell', { name: /26\/10.*cardio feito/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Legenda' })).toHaveTextContent('Treino não feito')

    expect(screen.getByRole('img', { name: /83,1 kg → 82,4 kg/ })).toBeInTheDocument()
    const strength = screen.getByRole('region', { name: 'Força por grupo' })
    expect(within(strength).getByText('Peito')).toBeInTheDocument()
    expect(within(strength).getByText('Supino reto')).toBeInTheDocument()
  })

  it('shows the "Sequência" (current and records) and "Semanas na meta" cards', async () => {
    const app = await setupApp()
    await seedGamificationHistory(app.db) // same today (10-27): streak 12, one perfect week of two closed
    app.view(<SummaryPage />)

    const card = within(await screen.findByRole('region', { name: 'Constância' }))
    expect(card.getByText('Sequência').nextSibling).toHaveTextContent('12 dias')
    expect(card.getByText('recorde: 12 dias no ciclo, 12 dias no geral')).toBeInTheDocument()
    expect(card.getByText('Semanas na meta').nextSibling).toHaveTextContent('1 de 2')
    expect(card.getByRole('link', { name: 'Ver conquistas' })).toHaveAttribute('href', '/conquistas')
  })

  it('a failure computing the progress only hides the "Constância" cards', async () => {
    vi.mocked(loadProgress).mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05' })
    app.view(<SummaryPage />)

    expect(await screen.findByRole('region', { name: 'Números do ciclo' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Constância' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.mocked(console.error).mockRestore()
  })

  it('"Semanas na meta" says so when no week has closed yet', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05' })
    app.view(<SummaryPage />)

    const card = within(await screen.findByRole('region', { name: 'Constância' }))
    expect(card.getByText('Sequência').nextSibling).toHaveTextContent('0 dias')
    expect(card.getByText('Semanas na meta').nextSibling).toHaveTextContent('—')
    expect(card.getByText('nenhuma semana fechada ainda')).toBeInTheDocument()
  })

  it('says how late the update is once past the update date', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-10-25' })
    app.view(<SummaryPage />)
    expect(await screen.findByText('Atualização atrasada há 2 dias')).toBeInTheDocument()
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument()
  })

  it('applies rotation overrides set before the protocol cycle started, like /treino does', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'off']) // anchored on 2026-10-18 (a), so 2026-10-28 would be a workout day
    await seedProtocol(app.db, { updateDate: '2026-12-05' }) // cycle starts on the 20th
    // Before the cycle start but after the workout version was activated (10-10): postpones the rotation by one day.
    await rotationOverrideRepo.set(app.db, USER_A, '2026-10-12', 'off', new Date(2026, 9, 12, 8))
    app.view(<SummaryPage />)

    const calendar = await screen.findByRole('table', { name: 'Calendário do ciclo' })
    expect(within(calendar).getByRole('cell', { name: '28/10, ainda não chegou' })).toBeInTheDocument()
  })

  it('shows Dieta and Itens do protocolo for the cycle so far: 2 done + 1 partial of 4 planned meals is "63%"', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0)) // cycle 20..23: four days
    const app = await setupApp()
    await seedProtocol(app.db, {
      updateDate: '2026-12-05',
      meals: [{ key: '1', label: 'REF 1', items: [] }],
      items: [{ key: 'creatina', category: 'supplement', name: 'Creatina', timing: 'any', schedule: { type: 'daily' } }],
    })
    const mark = (date: string, targetType: 'meal' | 'protocol_item', targetKey: string, status: 'done' | 'partial' | 'missed') =>
      adherenceRepo.mark(app.db, USER_A, { date, targetType, targetKey, status }, new Date(2026, 9, 23, 12))
    await mark('2026-10-20', 'meal', '1', 'done')
    await mark('2026-10-21', 'meal', '1', 'done')
    await mark('2026-10-22', 'meal', '1', 'partial')
    await mark('2026-10-23', 'meal', '1', 'missed')
    await mark('2026-10-21', 'protocol_item', 'creatina', 'done')
    await mark('2026-10-19', 'meal', '1', 'done') // before the cycle
    app.view(<SummaryPage />)

    const diet = (await screen.findByText('Dieta')).parentElement!
    expect(within(diet).getByText('63%')).toBeInTheDocument()
    expect(within(diet).getByText('2 feitas · 1 parcial de 4')).toBeInTheDocument()
    const items = screen.getByText('Itens do protocolo').closest('div')!
    // Today (the 23rd) the untimed, unmarked item is not due yet: 3 planned.
    expect(within(items).getByText('33%')).toBeInTheDocument()
    expect(within(items).getByText('1 feito · 0 parciais de 3 previstos')).toBeInTheDocument()
    // No item ran out in the cycle: no line for it.
    expect(screen.queryByText('Itens que acabaram')).not.toBeInTheDocument()
  })

  it('"Itens que acabaram" counts the days of the cycle with an item marked "Acabou"', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0))
    const app = await setupApp()
    await seedProtocol(app.db, {
      updateDate: '2026-12-05',
      items: [{ key: 'creatina', category: 'supplement', name: 'Creatina', timing: 'any', schedule: { type: 'daily' } }],
    })
    const ranOut = (date: string) =>
      adherenceRepo.mark(app.db, USER_A, { date, targetType: 'protocol_item', targetKey: 'creatina', status: 'missed', reason: 'ran_out' }, new Date(2026, 9, 23, 12))
    await ranOut('2026-10-19') // before the cycle
    await ranOut('2026-10-21')
    await ranOut('2026-10-22')
    app.view(<SummaryPage />)

    const line = (await screen.findByText('Itens que acabaram')).closest('div')!
    expect(within(line).getByText('2 dias')).toBeInTheDocument()
  })

  it('"Desvios na dieta" counts the cycle\'s deviations, lowers Dieta and opens the list by day', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0)) // cycle 20..23
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05', meals: [{ key: '1', label: 'Café', items: [] }] })
    const at = new Date(2026, 9, 23, 12)
    for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) await adherenceRepo.mark(app.db, USER_A, { date, targetType: 'meal', targetKey: '1', status: 'done' }, at)
    await dietDeviationRepo.add(app.db, { date: '2026-10-21', mealKey: '1', time: null, description: 'Biscoito', quantity: '3 unidades' }, at)
    await dietDeviationRepo.add(app.db, { date: '2026-10-22', mealKey: null, time: '21:00', description: 'Pizza', quantity: null }, at)
    const gone = await dietDeviationRepo.add(app.db, { date: '2026-10-22', mealKey: null, time: null, description: 'Apagado', quantity: null }, at)
    await dietDeviationRepo.remove(app.db, gone, new Date(2026, 9, 23, 12, 1))
    await dietDeviationRepo.add(app.db, { date: '2026-10-19', mealKey: '1', time: null, description: 'Antes do ciclo', quantity: null }, at)
    app.view(<SummaryPage />)

    // 3 done of 3 meals planned so far (the 23rd's untimed meal is not due yet) + 2 deviations: 60 %.
    const diet = (await screen.findByText('Dieta')).parentElement!
    expect(within(diet).getByText('60%')).toBeInTheDocument()
    const user = userEvent.setup({ advanceTimers: () => undefined })
    await user.click(screen.getByRole('button', { name: /Desvios na dieta.*2 no ciclo/ }))

    const sheet = within(screen.getByRole('dialog', { name: 'Desvios na dieta' }))
    const days = sheet.getAllByRole('listitem').filter((li) => li.hasAttribute('aria-labelledby'))
    expect(days.map((d) => within(d).getByRole('heading').textContent)).toEqual(['quinta-feira, 22 de outubro', 'quarta-feira, 21 de outubro'])
    expect(within(days[0]!).getByText('Pizza')).toBeInTheDocument()
    expect(within(days[0]!).getByText('Fora do plano · 21:00')).toBeInTheDocument()
    expect(within(days[1]!).getByText('Biscoito')).toBeInTheDocument()
    expect(within(days[1]!).getByText('Café')).toBeInTheDocument()
    expect(within(days[1]!).getByText('3 unidades')).toBeInTheDocument()
    expect(sheet.queryByText('Apagado')).not.toBeInTheDocument()
    expect(sheet.queryByText('Antes do ciclo')).not.toBeInTheDocument()
  })

  it('Cardio counts a day once whether it was done in the check-in or marked on Hoje', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05', cardio: { daily: true } })
    const checkin = async (date: string, cardioDone: boolean) => {
      const at = new Date(2026, 9, 27, 12)
      await dailyCheckinRepo.saveMorning(app.db, USER_A, date, { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }, at)
      await dailyCheckinRepo.saveEvening(app.db, USER_A, date, { energyDay: 3, anxiety: 2, waterL: 3, note: null }, at)
      await dailyCheckinRepo.setCardio(app.db, USER_A, date, { done: cardioDone, minutes: null }, at)
    }
    const cardio = (date: string, status: 'done' | 'missed') =>
      adherenceRepo.mark(app.db, USER_A, { date, targetType: 'cardio', targetKey: 'cardio', status }, new Date(2026, 9, 27, 12))
    await checkin('2026-10-21', true)
    await cardio('2026-10-21', 'done') // same day: once
    await cardio('2026-10-22', 'done') // mark only
    await checkin('2026-10-23', false)
    await cardio('2026-10-24', 'missed')
    app.view(<SummaryPage />)

    const row = (await screen.findByText('Cardio')).closest('div')!
    expect(within(row).getByText('2 de 8')).toBeInTheDocument()
  })

  it('Dieta shows "—" when the protocol has no meals', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05' })
    app.view(<SummaryPage />)
    const diet = (await screen.findByText('Dieta')).parentElement!
    expect(within(diet).getByText('—')).toBeInTheDocument()
  })

  it('with fewer than two weigh-ins the weight section is a sentence, not a chart', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05' })
    app.view(<SummaryPage />)
    expect(await screen.findByText('Sem pesagens no ciclo.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Peso/ })).not.toBeInTheDocument()
  })

  it('a single weigh-in says the chart starts at the second one', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-12-05' })
    await dailyCheckinRepo.saveMorning(app.db, USER_A, '2026-10-26', { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: 82.4 }, new Date(2026, 9, 26, 8))
    app.view(<SummaryPage />)
    expect(await screen.findByText(/Uma pesagem no ciclo \(82,4 kg\)/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Peso/ })).not.toBeInTheDocument()
  })
})
