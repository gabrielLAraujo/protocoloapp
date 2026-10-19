import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { json, mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { BENCH, seedExercises, seedPastSession, seedPlan } from '../workout/testData'
import { SummaryPage } from './SummaryPage'

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
              payload: { kind: 'protocol', status: 'active', document: { phaseName: 'Fase 1', updateDate: '2026-11-15', billingDate: '2026-11-05' }, activated_at: new Date(2026, 9, 20, 12).toISOString(), low_confidence: [] },
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

    await user.type(screen.getByLabelText('Próxima atualização'), '2026-11-15')
    await user.type(screen.getByLabelText('Mensalidade'), '2026-11-05')
    await user.click(save)

    expect(await screen.findByText('Faltam 19 dias para a atualização')).toBeInTheDocument()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(JSON.parse(patch.body)).toEqual({ updateDate: '2026-11-15', billingDate: '2026-11-05' })
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
      updateDate: '2026-11-15',
      billingDate: '2026-11-05',
      cardio: { daily: true },
      guidelines: [{ kind: 'water_min_l', value: 3 }],
    })
    await seedPastSession(app.db, '2026-10-21', BENCH, [[60, 10]])
    await seedPastSession(app.db, '2026-10-25', BENCH, [[70, 10]])
    await dailyCheckinRepo.upsert(
      app.db, USER_A, '2026-10-26',
      { sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 4, anxiety: 2, waterL: 2.5, weightKg: 82.4, note: null, cardioDone: true, cardioMinutes: 30 },
      new Date(2026, 9, 26, 8),
    )
    app.view(<SummaryPage />)

    expect(await screen.findByText('Faltam 19 dias para a atualização')).toBeInTheDocument()
    expect(screen.getByText('05/11')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Andamento do ciclo' })).toBeInTheDocument()

    const stats = screen.getByRole('region', { name: 'Números do ciclo' })
    expect(within(stats).getByText('Treinos').nextSibling).toHaveTextContent('2 de 8')
    expect(within(stats).getByText('Cardio').nextSibling).toHaveTextContent('1 de 8')
    expect(within(stats).getByText('Água').nextSibling).toHaveTextContent('2,5 L')

    const calendar = screen.getByRole('table', { name: 'Calendário do ciclo' })
    expect(within(calendar).getByRole('cell', { name: /21\/10, treino feito/ })).toHaveTextContent('✓')
    expect(within(calendar).getByRole('cell', { name: /27\/10, hoje/ })).toHaveAttribute('aria-current', 'date')
    expect(within(calendar).getByRole('cell', { name: /26\/10.*cardio feito/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Legenda' })).toHaveTextContent('Treino não feito')

    expect(screen.getByRole('img', { name: /82,4 kg → 82,4 kg/ })).toBeInTheDocument()
    const strength = screen.getByRole('region', { name: 'Força por grupo' })
    expect(within(strength).getByText('Peito')).toBeInTheDocument()
    expect(within(strength).getByText('Supino reto')).toBeInTheDocument()
  })

  it('says how late the update is once past the update date', async () => {
    const app = await setupApp()
    await seedProtocol(app.db, { updateDate: '2026-10-25' })
    app.view(<SummaryPage />)
    expect(await screen.findByText('Atualização atrasada há 2 dias')).toBeInTheDocument()
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument()
  })
})
