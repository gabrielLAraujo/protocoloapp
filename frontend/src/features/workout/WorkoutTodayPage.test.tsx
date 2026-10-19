import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workoutRepo } from '../../data/workoutRepo'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { BENCH, PLAN, seedExercises, seedPastSession, seedPlan } from './testData'
import { WorkoutTodayPage } from './WorkoutTodayPage'

// Local noon of the 18th: the rotation anchor of the fixtures is that day (position 0).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0))
  mockFetch({}) // offline
})

async function render(items: string[] = ['a', 'b']) {
  const app = await setupApp()
  await seedExercises(app.db)
  await seedPlan(app.db, items)
  const user = userEvent.setup()
  const ui = app.view(<WorkoutTodayPage />)
  return { ...app, ui, user }
}

const bench = () => within(screen.getByRole('region', { name: 'Supino reto' }))

const typeSet = async (user: ReturnType<typeof userEvent.setup>, n: number, weight: string, reps: string) => {
  await user.type(bench().getByLabelText(`Carga da série ${n} (kg)`), weight)
  await user.type(bench().getByLabelText(`Repetições da série ${n}`), reps)
}

async function startWorkout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Começar treino' }))
  await screen.findByText('Treino em andamento')
}

describe('WorkoutTodayPage', () => {
  it('shows "Hoje é descanso" on a rest day', async () => {
    await render(['off', 'a'])
    expect(await screen.findByRole('heading', { name: 'Hoje é descanso' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Começar treino' })).not.toBeInTheDocument()
  })

  it('shows the empty state with a shortcut to the planning when there is no active plan', async () => {
    const app = await setupApp()
    app.view(<WorkoutTodayPage />)
    expect(await screen.findByText('Nenhuma ficha de treino ativa.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir para o Planejamento' })).toHaveAttribute('href', '/planejamento')
  })

  it("shows the day's name and notes, and an override swaps the workout shown", async () => {
    const { user } = await render()
    expect(await screen.findByRole('heading', { name: 'Treino A — Peito' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Trocar o treino de hoje' }))
    const panel = screen.getByRole('region', { name: 'Trocar o treino de hoje' })
    expect(within(panel).getByRole('button', { name: 'Descanso' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: /Treino B/ }))
    expect(await screen.findByRole('heading', { name: 'Treino B — Pernas' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Trocar o treino de hoje' }))
    await user.click(screen.getByRole('button', { name: 'Descanso' }))
    expect(await screen.findByRole('heading', { name: 'Hoje é descanso' })).toBeInTheDocument()
  })

  it('marking a set stores a set_log and starts the rest timer from restSeconds', async () => {
    const { db, user } = await render()
    await startWorkout(user)

    await typeSet(user, 1, '82,5', '9')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))

    expect(await screen.findByText('Descanso 01:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+15 s' })).toBeInTheDocument()
    const open = (await workoutRepo.openSession(db))!
    const sets = await workoutRepo.setsForSession(db, open.id)
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ exerciseId: BENCH, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 82.5, reps: 9, kind: 'normal' })
    expect(bench().getByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+15 s' }))
    expect(screen.getByText('Descanso 01:45')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pular' }))
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()
  })

  it('a drop technique pre-selects the drop kind', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    expect(screen.getByLabelText('Tipo da série 2')).toHaveValue('drop')
    expect(screen.getByText(/6–8 reps/)).toBeInTheDocument()
    expect(screen.getByText(/\+ drop/)).toBeInTheDocument()

    await typeSet(user, 2, '60', '8')
    await user.click(bench().getByRole('button', { name: 'Concluir série 2' }))
    const open = (await workoutRepo.openSession(db))!
    await waitFor(async () => expect(await workoutRepo.setsForSession(db, open.id)).toHaveLength(1))
    expect((await workoutRepo.setsForSession(db, open.id))[0]!.kind).toBe('drop')
  })

  it('tapping a done set opens it prefilled for editing and saves through updateSet (no new timer)', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await screen.findByText('Descanso 01:30')
    await user.click(screen.getByRole('button', { name: 'Pular' }))

    await user.click(await bench().findByRole('button', { name: 'Editar série 1' }))
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('80')
    expect(bench().getByLabelText('Repetições da série 1')).toHaveValue('10')
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toBeEnabled()

    await user.clear(bench().getByLabelText('Carga da série 1 (kg)'))
    await user.type(bench().getByLabelText('Carga da série 1 (kg)'), '82,5')
    await user.clear(bench().getByLabelText('Repetições da série 1'))
    await user.type(bench().getByLabelText('Repetições da série 1'), '9')
    await user.click(bench().getByRole('button', { name: 'Salvar série 1' }))

    const open = (await workoutRepo.openSession(db))!
    await waitFor(async () => expect((await workoutRepo.setsForSession(db, open.id))[0]).toMatchObject({ weightKg: 82.5, reps: 9 }))
    expect(await bench().findByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('82,5')
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toBeDisabled()
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()
  })

  it('editing validates the ranges and Cancelar keeps the stored values', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await user.click(await bench().findByRole('button', { name: 'Editar série 1' }))

    await user.clear(bench().getByLabelText('Carga da série 1 (kg)'))
    await user.type(bench().getByLabelText('Carga da série 1 (kg)'), '1001')
    await user.click(bench().getByRole('button', { name: 'Salvar série 1' }))
    expect(await bench().findByText('Máximo de 1000 kg')).toBeInTheDocument()

    await user.click(bench().getByRole('button', { name: 'Cancelar' }))
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('80')
    const open = (await workoutRepo.openSession(db))!
    expect((await workoutRepo.setsForSession(db, open.id))[0]).toMatchObject({ weightKg: 80, reps: 10 })
  })

  it('deleting a set needs the explicit "Excluir série" action', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    const open = (await workoutRepo.openSession(db))!
    await user.click(await bench().findByRole('button', { name: 'Editar série 1' }))
    expect(await workoutRepo.setsForSession(db, open.id)).toHaveLength(1)

    await user.click(bench().getByRole('button', { name: 'Excluir série 1' }))
    await waitFor(async () => expect(await workoutRepo.setsForSession(db, open.id)).toHaveLength(0))
    expect(await bench().findByRole('button', { name: 'Concluir série 1' })).toBeInTheDocument()
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('')
    expect(bench().getByLabelText('Repetições da série 1')).toHaveValue('')
    expect(bench().getByLabelText('Tipo da série 1')).toHaveValue('normal')
  })

  it('"Adicionar série" grows by one row each time, even after logging an extra row', async () => {
    const { user } = await render()
    await startWorkout(user)
    const rows = () => bench().getAllByRole('listitem').length
    expect(rows()).toBe(2)
    await user.click(bench().getByRole('button', { name: 'Adicionar série' }))
    expect(rows()).toBe(3)
    await typeSet(user, 3, '50', '12')
    await user.click(bench().getByRole('button', { name: 'Concluir série 3' }))
    await bench().findByRole('button', { name: 'Editar série 3' })
    expect(rows()).toBe(3)
    await user.click(bench().getByRole('button', { name: 'Adicionar série' }))
    expect(rows()).toBe(4)
  })

  it('"Adicionar série" still adds a row after a reload with an extra row logged', async () => {
    const { ui, view, user } = await render()
    await startWorkout(user)
    await user.click(bench().getByRole('button', { name: 'Adicionar série' }))
    await typeSet(user, 3, '50', '12')
    await user.click(bench().getByRole('button', { name: 'Concluir série 3' }))
    await bench().findByRole('button', { name: 'Editar série 3' })

    ui.unmount()
    view(<WorkoutTodayPage />)
    await screen.findByText('Treino em andamento')
    await within(await screen.findByRole('region', { name: 'Supino reto' })).findByRole('button', { name: 'Editar série 3' })
    expect(bench().getAllByRole('listitem')).toHaveLength(3)
    await user.click(bench().getByRole('button', { name: 'Adicionar série' }))
    expect(bench().getAllByRole('listitem')).toHaveLength(4)
  })

  it('a 0 in the rest sequence shows as a dash in the card header', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'], undefined, (doc) => {
      doc.days[0]!.exercises[0] = { ...doc.days[0]!.exercises[0]!, restSequence: [0, 45] } as never
    })
    const user = userEvent.setup()
    app.view(<WorkoutTodayPage />)
    await startWorkout(user)
    expect(bench().getByText('Descanso: — / 45 s')).toBeInTheDocument()
  })

  it('reloading in the middle restores the open session, the marked sets and the timer', async () => {
    const { ui, view, user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await screen.findByText('Descanso 01:30')

    ui.unmount()
    view(<WorkoutTodayPage />)

    expect(await screen.findByText('Treino em andamento')).toBeInTheDocument()
    expect(await bench().findByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('80')
    expect(bench().getByLabelText('Repetições da série 1')).toHaveValue('10')
    expect(screen.getByText('Descanso 01:30')).toBeInTheDocument()
  })

  it('works when localStorage throws (the timer just does not persist)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    expect(await screen.findByText('Descanso 01:30')).toBeInTheDocument()
  })

  it('shows "Última vez" from the previous session of the same exercise', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedPastSession(app.db, '2026-10-11', BENCH, [
      [80, 10],
      [80, 9],
    ])
    await seedPastSession(app.db, '2026-10-04', BENCH, [[70, 12]])
    app.view(<WorkoutTodayPage />)
    const user = userEvent.setup()
    await startWorkout(user)
    expect(await screen.findByText('Última vez: 80 kg × 10 · 80 × 9')).toBeInTheDocument()
    // The previous values are hints in the empty fields.
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveAttribute('placeholder', '80')
    expect(bench().getByLabelText('Repetições da série 2')).toHaveAttribute('placeholder', '9')
  })

  it('refuses values outside the server ranges with a pt-BR message and stores nothing', async () => {
    const { db, user } = await render()
    await startWorkout(user)

    await typeSet(user, 1, '1000,5', '201')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    expect(await screen.findByText('Máximo de 1000 kg')).toBeInTheDocument()
    expect(screen.getByText('Máximo de 200 repetições')).toBeInTheDocument()
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveAttribute('aria-invalid', 'true')

    await user.clear(bench().getByLabelText('Carga da série 1 (kg)'))
    await user.type(bench().getByLabelText('Carga da série 1 (kg)'), '80,123')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    expect(await screen.findByText('Use até 2 casas decimais')).toBeInTheDocument()

    const open = (await workoutRepo.openSession(db))!
    expect(await workoutRepo.setsForSession(db, open.id)).toHaveLength(0)
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()
  })

  it('skipping an exercise records an exercise_change with the note', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    const card = screen.getByRole('region', { name: 'Crucifixo' })

    await user.click(within(card).getByRole('button', { name: 'Pular exercício' }))
    await user.type(within(card).getByLabelText('Motivo (opcional)'), 'Ombro doendo')
    await user.click(within(card).getByRole('button', { name: 'Confirmar pulo' }))

    expect(await within(card).findByText('Exercício pulado — Ombro doendo')).toBeInTheDocument()
    const open = (await workoutRepo.openSession(db))!
    expect(await workoutRepo.changesForSession(db, open.id)).toMatchObject([{ plannedExerciseKey: 'e2', action: 'skipped', note: 'Ombro doendo' }])

    await user.click(within(card).getByRole('button', { name: 'Desfazer pulo' }))
    await waitFor(() => expect(within(card).queryByText(/Exercício pulado/)).not.toBeInTheDocument())
    // Not faked as a swap: the skip is soft-deleted and nothing else is recorded.
    expect(await workoutRepo.changesForSession(db, open.id)).toEqual([])
    expect(within(card).queryByText(/Trocado de/)).not.toBeInTheDocument()
    expect(within(card).getByLabelText('Carga da série 1 (kg)')).toBeInTheDocument()
  })

  it('a skip can be cleared even when the planned exercise is not in the catalog', async () => {
    const app = await setupApp()
    await seedPlan(app.db, ['a', 'b']) // no exercises seeded
    const user = userEvent.setup()
    app.view(<WorkoutTodayPage />)
    await startWorkout(user)
    const card = screen.getByRole('region', { name: 'Crucifixo' })
    await user.click(within(card).getByRole('button', { name: 'Pular exercício' }))
    await user.click(within(card).getByRole('button', { name: 'Confirmar pulo' }))
    await within(card).findByText('Exercício pulado')

    await user.click(within(card).getByRole('button', { name: 'Desfazer pulo' }))
    expect(await within(card).findByText(/ainda não está no catálogo/)).toBeInTheDocument()
    const open = (await workoutRepo.openSession(app.db))!
    expect(await workoutRepo.changesForSession(app.db, open.id)).toEqual([])
  })

  it('swapping back to the planned exercise does not show "Trocado de"', async () => {
    const { user } = await render()
    await startWorkout(user)
    const card = screen.getByRole('region', { name: 'Crucifixo' })
    await user.click(within(card).getByRole('button', { name: 'Trocar exercício' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Agachamento/ }))
    const swapped = await screen.findByRole('region', { name: 'Agachamento' })
    expect(within(swapped).getByText('Trocado de “Crucifixo”')).toBeInTheDocument()
    await user.click(within(swapped).getByRole('button', { name: 'Trocar exercício' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Crucifixo/ }))
    const back = await screen.findByRole('region', { name: 'Crucifixo' })
    expect(within(back).queryByText(/Trocado de/)).not.toBeInTheDocument()
  })

  it('a failing write shows "Não consegui salvar. Tente de novo." instead of failing silently', async () => {
    const { user } = await render()
    await startWorkout(user)
    vi.spyOn(workoutRepo, 'recordChange').mockRejectedValue(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const card = screen.getByRole('region', { name: 'Crucifixo' })
    await user.click(within(card).getByRole('button', { name: 'Pular exercício' }))
    await user.click(within(card).getByRole('button', { name: 'Confirmar pulo' }))
    expect(await within(card).findByText('Não consegui salvar. Tente de novo.')).toBeInTheDocument()
    // The form stays open so nothing typed is lost.
    expect(within(card).getByRole('button', { name: 'Confirmar pulo' })).toBeInTheDocument()
  })

  it('a 0 in the rest sequence means no timer after that set', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'], undefined, (doc) => {
      doc.days[0]!.exercises[0] = { ...doc.days[0]!.exercises[0]!, restSequence: [0, 45] } as never
    })
    const user = userEvent.setup()
    app.view(<WorkoutTodayPage />)
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await bench().findByRole('button', { name: 'Editar série 1' })
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()
    await typeSet(user, 2, '80', '10')
    await user.click(bench().getByRole('button', { name: 'Concluir série 2' }))
    expect(await screen.findByText('Descanso 00:45')).toBeInTheDocument()
  })

  it('keeps the session on screen when midnight passes mid-workout', async () => {
    const { user } = await render()
    await startWorkout(user)
    await typeSet(user, 1, '80', '10')

    vi.setSystemTime(new Date(2026, 9, 19, 0, 5))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // Still the same workout with what was typed, no "treino aberto" prompt.
    await waitFor(() => expect(screen.queryByText(/Você tem um treino aberto/)).not.toBeInTheDocument())
    expect(screen.getByText('Treino em andamento')).toBeInTheDocument()
    expect(bench().getByLabelText('Carga da série 1 (kg)')).toHaveValue('80')
  })

  it('swapping an exercise searches the catalog and logs sets for the replacement', async () => {
    const { db, user } = await render()
    await startWorkout(user)
    const card = screen.getByRole('region', { name: 'Crucifixo' })

    await user.click(within(card).getByRole('button', { name: 'Trocar exercício' }))
    const dialog = screen.getByRole('dialog', { name: 'Trocar exercício' })
    await user.type(within(dialog).getByLabelText('Buscar exercício'), 'agacha')
    await user.click(within(dialog).getByRole('button', { name: /Agachamento/ }))

    const swapped = await screen.findByRole('region', { name: 'Agachamento' })
    expect(within(swapped).getByText('Trocado de “Crucifixo”')).toBeInTheDocument()
    await user.type(within(swapped).getByLabelText('Carga da série 1 (kg)'), '100')
    await user.type(within(swapped).getByLabelText('Repetições da série 1'), '8')
    await user.click(within(swapped).getByRole('button', { name: 'Concluir série 1' }))

    const open = (await workoutRepo.openSession(db))!
    await waitFor(async () => expect(await workoutRepo.setsForSession(db, open.id)).toHaveLength(1))
    expect((await workoutRepo.setsForSession(db, open.id))[0]).toMatchObject({ exerciseId: '7d1f2a10-0000-5000-8000-0000000000e3', plannedExerciseKey: 'e2' })
    expect(await workoutRepo.changesForSession(db, open.id)).toMatchObject([{ action: 'swapped', plannedExerciseKey: 'e2' }])
  })

  it('finishing shows duration, volume per group and a record that beats the history', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedPastSession(app.db, '2026-10-11', BENCH, [[100, 5]])
    const user = userEvent.setup()
    app.view(<WorkoutTodayPage />)
    await startWorkout(user)

    await typeSet(user, 1, '110', '5')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await bench().findByRole('button', { name: 'Editar série 1' })

    await user.click(screen.getByRole('button', { name: 'Finalizar treino' }))
    await user.click(screen.getByRole('button', { name: 'Sim, finalizar' }))

    expect(await screen.findByRole('heading', { name: 'Treino finalizado' })).toBeInTheDocument()
    const groups = screen.getByRole('region', { name: 'Volume por grupo' })
    expect(within(groups).getByText('Peito')).toBeInTheDocument()
    expect(within(groups).getByText('550 kg')).toBeInTheDocument()
    expect(screen.getByText('Novo recorde: Supino reto — 110 kg')).toBeInTheDocument()
    expect(await workoutRepo.openSession(app.db)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(await screen.findByText('Você já concluiu um treino hoje.')).toBeInTheDocument()
  })

  it('finishing without beating the history shows no record', async () => {
    const app = await setupApp()
    await seedExercises(app.db)
    await seedPlan(app.db, ['a', 'b'])
    await seedPastSession(app.db, '2026-10-11', BENCH, [[120, 5]])
    const user = userEvent.setup()
    app.view(<WorkoutTodayPage />)
    await startWorkout(user)
    await typeSet(user, 1, '100', '5')
    await user.click(bench().getByRole('button', { name: 'Concluir série 1' }))
    await bench().findByRole('button', { name: 'Editar série 1' })
    await user.click(screen.getByRole('button', { name: 'Finalizar treino' }))
    await user.click(screen.getByRole('button', { name: 'Sim, finalizar' }))
    await screen.findByRole('heading', { name: 'Treino finalizado' })
    expect(screen.queryByText(/Novo recorde/)).not.toBeInTheDocument()
  })

  describe('an open session from a previous day', () => {
    async function withOldSession(withSet: boolean) {
      const app = await setupApp()
      await seedExercises(app.db)
      await seedPlan(app.db, ['a', 'b'])
      const started = new Date(2026, 9, 17, 18, 0)
      const id = await workoutRepo.startSession(app.db, USER_A, { date: '2026-10-17', planVersionId: PLAN, dayKey: 'a' }, started)
      const lastSet = new Date(2026, 9, 17, 18, 40)
      if (withSet) {
        await workoutRepo.logSet(app.db, USER_A, { sessionId: id, exerciseId: BENCH, plannedExerciseKey: 'e1', setIndex: 0, weightKg: 80, reps: 10, kind: 'normal' }, lastSet)
      }
      app.view(<WorkoutTodayPage />)
      return { ...app, id, started, lastSet }
    }

    it('offers Continuar and Encerrar; Encerrar ends it at the last set', async () => {
      const { db, id, lastSet } = await withOldSession(true)
      const user = userEvent.setup()
      expect(await screen.findByText('Você tem um treino aberto de 17/10')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Encerrar' }))
      expect(await screen.findByRole('button', { name: 'Começar treino' })).toBeInTheDocument()
      const [session] = await workoutRepo.sessionsBetween(db, '2026-10-17', '2026-10-17')
      expect(session).toMatchObject({ id, endedAt: lastSet.toISOString() })
    })

    it('Encerrar without sets ends it at the start', async () => {
      const { db, started } = await withOldSession(false)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Encerrar' }))
      await screen.findByRole('button', { name: 'Começar treino' })
      const [session] = await workoutRepo.sessionsBetween(db, '2026-10-17', '2026-10-17')
      expect(session!.endedAt).toBe(started.toISOString())
    })

    it('Continuar opens the session', async () => {
      await withOldSession(true)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Continuar' }))
      expect(await screen.findByText('Treino em andamento')).toBeInTheDocument()
      expect(await bench().findByRole('button', { name: 'Editar série 1' })).toBeInTheDocument()
    })
  })
})
