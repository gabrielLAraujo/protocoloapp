import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../../domain/calendarDate'
import { workoutRepo } from '../../data/workoutRepo'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { ExerciseHistoryPage } from './ExerciseHistoryPage'
import { HistoryPage } from './HistoryPage'
import { SessionEditPage } from './SessionEditPage'
import { adherenceRepo } from '../../data/adherenceRepo'
import { BENCH, PLAN, seedExercises, seedHevySession, seedPastSession, seedPlan } from './testData'

async function seeded(entry: string) {
  const app = await setupApp([entry])
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  await seedPastSession(app.db, '2026-10-04', BENCH, [[70, 12]])
  await seedPastSession(app.db, '2026-10-11', BENCH, [
    [80, 10],
    [80, 9],
  ])
  app.view(
    <Routes>
      <Route path="/treino/historico" element={<HistoryPage />} />
      <Route path="/treino/historico/:id" element={<SessionEditPage />} />
      <Route path="/treino/exercicio/:id" element={<ExerciseHistoryPage />} />
    </Routes>,
  )
  return app
}

describe('HistoryPage', () => {
  it('lists sessions newest first with date, day and volume, and links to the exercise', async () => {
    await seeded('/treino/historico')
    const list = await screen.findByRole('region', { name: 'Sessões' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('11/10/2026')
    expect(items[0]).toHaveTextContent('Treino A')
    expect(items[0]).toHaveTextContent('1.520 kg')
    expect(items[1]).toHaveTextContent('04/10/2026')
    expect(items[1]).toHaveTextContent('840 kg')

    const link = screen.getByRole('link', { name: /Supino reto/ })
    expect(link).toHaveAttribute('href', `/treino/exercicio/${BENCH}`)
    await userEvent.setup().click(link)
    expect(await screen.findByRole('heading', { name: 'Supino reto' })).toBeInTheDocument()
  })

  it('reads one aggregate query, shows the last 60 sessions and "Carregar mais" brings the rest', async () => {
    const app = await setupApp(['/treino/historico'])
    await seedPlan(app.db, ['a', 'b'])
    for (let i = 0; i < 61; i++) {
      await workoutRepo.startSession(app.db, USER_A, { date: addDays('2026-01-01', i), planVersionId: PLAN, dayKey: 'a' }, new Date(2026, 0, 1 + i, 10))
    }
    const perSession = vi.spyOn(workoutRepo, 'setsForSession')
    const summaries = vi.spyOn(workoutRepo, 'sessionSummaries')
    app.view(<HistoryPage />)

    const list = await screen.findByRole('region', { name: 'Sessões' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(60)
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('02/03/2026')
    expect(perSession).not.toHaveBeenCalled()
    expect(summaries).toHaveBeenCalledTimes(1)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Carregar mais' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(61))
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
    expect(perSession).not.toHaveBeenCalled()
  })

  it('shows an empty message without sessions', async () => {
    const app = await setupApp(['/treino/historico'])
    app.view(<HistoryPage />)
    expect(await screen.findByText('Nenhum treino registrado ainda.')).toBeInTheDocument()
  })
})

describe('ExerciseHistoryPage', () => {
  it('shows one row per session with the sets and the best e1RM, plus the chart', async () => {
    await seeded(`/treino/exercicio/${BENCH}`)
    expect(await screen.findByRole('heading', { name: 'Supino reto' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /1RM estimado por sessão/ })).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Sessões' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('11/10/2026')
    expect(rows[0]).toHaveTextContent('80 × 10 · 80 × 9')
    expect(rows[0]).toHaveTextContent('106,7 kg')
    expect(rows[1]).toHaveTextContent('04/10/2026')
    expect(rows[1]).toHaveTextContent('98 kg')
  })
})

describe('fixing a past session from the history', () => {
  it('opens a finished session in log mode: change a load, delete and add sets, then save', async () => {
    const app = await seeded('/treino/historico')
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Sessões' })
    await user.click(within(list).getByRole('link', { name: /11\/10\/2026/ }))

    expect(await screen.findByText('Registro do treino de 11/10')).toBeInTheDocument()
    const bench = () => within(screen.getByRole('region', { name: 'Supino reto' }))
    await user.click(bench().getByRole('button', { name: 'Editar série 1' }))
    await user.clear(bench().getByLabelText('Carga da série 1 (kg)'))
    await user.type(bench().getByLabelText('Carga da série 1 (kg)'), '85')
    await user.click(bench().getByRole('button', { name: 'Salvar série 1' }))
    expect(await bench().findByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()

    await user.click(bench().getByRole('button', { name: 'Editar série 2' }))
    await user.click(bench().getByRole('button', { name: 'Excluir série 2' }))
    expect(await bench().findByRole('button', { name: 'Concluir série 2' })).toBeInTheDocument()

    const fly = within(screen.getByRole('region', { name: 'Crucifixo' }))
    await user.type(fly.getByLabelText('Carga da série 1 (kg)'), '20')
    await user.type(fly.getByLabelText('Repetições da série 1'), '12')
    await user.click(fly.getByRole('button', { name: 'Concluir série 1' }))
    expect(await fly.findByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar treino' }))
    expect(await screen.findByText('Treino de 11/10 salvo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Histórico de treinos' })).toBeInTheDocument()

    const [session] = await workoutRepo.sessionsBetween(app.db, '2026-10-11', '2026-10-11')
    const sets = await workoutRepo.setsForSession(app.db, session!.id)
    expect(sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [85, 10],
      [20, 12],
    ])
    // The new set is timed on that day, after the ones already there.
    expect(sets[1]!.completedAt.slice(0, 10)).toBe('2026-10-11')
    expect((await adherenceRepo.between(app.db, '2026-10-11', '2026-10-11')).map((l) => [l.targetType, l.status])).toEqual([['workout', 'done']])
  })

  it('an open session is not a link', async () => {
    const app = await setupApp(['/treino/historico'])
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await workoutRepo.startSession(app.db, USER_A, { date: '2026-10-12', planVersionId: PLAN, dayKey: 'a' }, new Date(2026, 9, 12, 9))
    app.view(<HistoryPage />)
    const list = await screen.findByRole('region', { name: 'Sessões' })
    expect(within(list).queryByRole('link')).not.toBeInTheDocument()
  })
})

const HEVY = '7d1f2a10-0000-5000-8000-00000000f001'

async function withHevy(entry: string, hevyDate: string) {
  const app = await setupApp([entry])
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  await seedPastSession(app.db, '2026-10-11', BENCH, [[80, 10]])
  await seedHevySession(app.db, HEVY, hevyDate, BENCH, [
    [82.5, 8, 8.5],
    [82.5, 7],
  ], 'Peito exemplo')
  app.view(
    <Routes>
      <Route path="/treino/historico" element={<HistoryPage />} />
      <Route path="/treino/historico/:id" element={<SessionEditPage />} />
    </Routes>,
  )
  return app
}

describe('Hevy sessions in the history', () => {
  it("lists a Hevy set's RPE in the exercise history", async () => {
    const app = await setupApp([`/treino/exercicio/${BENCH}`])
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedHevySession(app.db, HEVY, '2026-10-12', BENCH, [[82.5, 8, 8.5], [82.5, 7]])
    app.view(
      <Routes>
        <Route path="/treino/exercicio/:id" element={<ExerciseHistoryPage />} />
      </Routes>,
    )
    const table = await screen.findByRole('table', { name: 'Sessões' })
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('82,5 × 8 (RPE 8,5) · 82,5 × 7')
  })

  it('shows the "Hevy" chip and the Hevy title only on the imported session', async () => {
    await withHevy('/treino/historico', '2026-10-12')
    const list = await screen.findByRole('region', { name: 'Sessões' })
    const [hevy, app] = within(list).getAllByRole('listitem')
    expect(hevy).toHaveTextContent('12/10/2026')
    expect(within(hevy!).getByText('Hevy')).toBeInTheDocument()
    expect(hevy).toHaveTextContent('Treino A (Peito exemplo), 2 séries')
    expect(within(app!).queryByText('Hevy')).not.toBeInTheDocument()
    expect(screen.queryByText('Treino registrado no app e no Hevy')).not.toBeInTheDocument()
  })

  it('warns about the same workout in the app and in Hevy; "Manter o do app" deletes the Hevy one and the warning goes', async () => {
    const app = await withHevy('/treino/historico', '2026-10-11')
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Sessões' })
    expect(within(list).getByText('Treino registrado no app e no Hevy')).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Manter só um' }))
    const sheet = await screen.findByRole('dialog', { name: 'Manter só um registro' })
    expect(within(sheet).getByRole('button', { name: /Manter o do app/ })).toHaveTextContent('1 série, 800 kg')
    expect(within(sheet).getByRole('button', { name: /Manter o do Hevy/ })).toHaveTextContent('2 séries, 1.238 kg')
    await user.click(within(sheet).getByRole('button', { name: /Manter o do app/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Treino registrado no app e no Hevy')).not.toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(await workoutRepo.sessionById(app.db, HEVY)).toBeNull()
    expect((await adherenceRepo.between(app.db, '2026-10-11', '2026-10-11')).map((l) => [l.targetType, l.status])).toEqual([['workout', 'done']])
  })

  it('opens a Hevy session read-only, with its sets and RPE, and "Excluir do app" deletes it', async () => {
    const app = await withHevy(`/treino/historico/${HEVY}`, '2026-10-12')
    const user = userEvent.setup()
    expect(await screen.findByText('Registrado no Hevy. Para corrigir, edite no Hevy.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar treino' })).not.toBeInTheDocument()

    const bench = within(screen.getByRole('region', { name: 'Supino reto' }))
    const rows = bench.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('82,5 kg × 8')
    expect(rows[0]).toHaveTextContent('RPE 8,5')
    expect(rows[1]).toHaveTextContent('82,5 kg × 7')
    expect(rows[1]).not.toHaveTextContent('RPE')

    await user.click(screen.getByRole('button', { name: 'Excluir do app' }))
    expect(screen.getByText(/Ele continua no Hevy/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sim, excluir' }))
    expect(await screen.findByText('Treino de 12/10 excluído do app')).toBeInTheDocument()
    expect(await workoutRepo.sessionById(app.db, HEVY)).toBeNull()
  })
})
