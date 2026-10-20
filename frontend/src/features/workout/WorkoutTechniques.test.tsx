import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workoutRepo } from '../../data/workoutRepo'
import type { PlannedExercise } from '../../domain/planDocuments'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { seedExercises, seedPlan, type workoutDoc } from './testData'
import { WorkoutTodayPage } from './WorkoutTodayPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0))
  mockFetch({}) // offline
})

type Doc = ReturnType<typeof workoutDoc>
type Tweak = (doc: Doc) => void
const patch = (doc: Doc, index: number, over: Partial<PlannedExercise>) => {
  doc.days[0]!.exercises[index] = { ...doc.days[0]!.exercises[index]!, ...over } as never
}

async function render(tweak: Tweak) {
  const app = await setupApp()
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'], undefined, tweak)
  const user = userEvent.setup()
  const ui = app.view(<WorkoutTodayPage />)
  await user.click(await screen.findByRole('button', { name: 'Começar treino' }))
  await screen.findByText('Treino em andamento')
  return { ...app, ui, user }
}

const bench = () => within(screen.getByRole('region', { name: 'Supino reto' }))
const fly = () => within(screen.getByRole('region', { name: 'Crucifixo' }))

async function confirm(user: ReturnType<typeof userEvent.setup>, card: typeof bench, of: string, name: string, weight: string | null, reps: string) {
  if (weight !== null) {
    await user.clear(card().getByLabelText(`Carga ${of} (kg)`))
    await user.type(card().getByLabelText(`Carga ${of} (kg)`), weight)
  }
  await user.type(card().getByLabelText(`Repetições ${of}`), reps)
  await user.click(card().getByRole('button', { name: `Concluir ${name}` }))
  await card().findByRole('button', { name: `Editar ${name}` })
}

const sessionSets = async (db: Awaited<ReturnType<typeof setupApp>>['db']) => workoutRepo.setsForSession(db, (await workoutRepo.openSession(db))!.id)

/** Bench: drop on the last set (2 drops) + rest-pause, from the structured fields of the plan. */
const dropAndRestPause: Tweak = (doc) =>
  patch(doc, 0, {
    sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8, drops: 2, restPause: 1 }],
    techniques: [{ type: 'drop', count: 2, sets: 'last' }, { type: 'rest_pause', count: 1 }],
  })

describe('techniques in the workout', () => {
  it('a tag explains its technique on tap', async () => {
    const { user } = await render(dropAndRestPause)
    const tag = bench().getByRole('button', { name: 'Drop' })
    expect(tag).toHaveAttribute('aria-expanded', 'false')
    await user.click(tag)
    expect(tag).toHaveAttribute('aria-expanded', 'true')
    expect(bench().getByText(/reduza a carga cerca de 20% e continue sem descanso\. Faça 2 drops\./)).toBeInTheDocument()
    await user.click(bench().getByRole('button', { name: 'Rest-pause' }))
    expect(bench().getByText(/Descanse 10–15 s/)).toBeInTheDocument()
    expect(bench().queryByText(/Faça 2 drops/)).not.toBeInTheDocument()
    await user.click(bench().getByRole('button', { name: 'Fechar' }))
    expect(bench().queryByText(/Descanse 10–15 s/)).not.toBeInTheDocument()
  })

  it('drop on the last set + rest-pause: sub-set rows with suggested loads, short rests, then the normal rest; no duplicates on reload', async () => {
    const { db, ui, view, user } = await render(dropAndRestPause)
    // The set with sub-sets is a normal set; nothing shows under it before it is done.
    expect(bench().getByLabelText('Tipo da série 2')).toHaveValue('normal')
    expect(bench().queryByLabelText('Carga do drop 1 da série 2 (kg)')).not.toBeInTheDocument()

    await confirm(user, bench, 'da série 2', 'série 2', '60', '8')
    expect(bench().getByLabelText('Carga do rest-pause 1 da série 2 (kg)')).toHaveValue('60')
    expect(bench().getByLabelText('Carga do drop 1 da série 2 (kg)')).toHaveValue('48')
    expect(bench().getByLabelText('Carga do drop 2 da série 2 (kg)')).toHaveValue('38')
    expect(bench().getByLabelText('Repetições do drop 1 da série 2')).toHaveValue('')
    expect(await screen.findByText('Descanso 00:15')).toBeInTheDocument()

    await confirm(user, bench, 'do rest-pause 1 da série 2', 'rest-pause 1 da série 2', null, '3')
    // Next is a drop: no rest.
    await waitFor(() => expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument())
    await confirm(user, bench, 'do drop 1 da série 2', 'drop 1 da série 2', '50', '6')
    // The second drop follows the load actually done.
    expect(bench().getByLabelText('Carga do drop 2 da série 2 (kg)')).toHaveValue('40')

    ui.unmount()
    view(<WorkoutTodayPage />)
    await screen.findByText('Treino em andamento')
    expect(await bench().findByRole('button', { name: 'Editar drop 1 da série 2' })).toBeInTheDocument()
    expect(bench().getAllByLabelText(/^Carga do drop \d da série 2/)).toHaveLength(2)
    expect(bench().getAllByLabelText(/^Carga do rest-pause \d da série 2/)).toHaveLength(1)

    await confirm(user, bench, 'do drop 2 da série 2', 'drop 2 da série 2', null, '5')
    // After the last sub-set the exercise's rest applies.
    expect(await screen.findByText('Descanso 01:30')).toBeInTheDocument()

    const sets = await sessionSets(db)
    const parent = sets.find((s) => s.parentSetId === null)!
    expect(sets.map((s) => [s.kind, s.weightKg, s.reps, s.parentSetId, s.setIndex])).toEqual([
      ['normal', 60, 8, null, 1],
      ['rest_pause', 60, 3, parent.id, 1],
      ['drop', 50, 6, parent.id, 1],
      ['drop', 40, 5, parent.id, 1],
    ])
  })

  it('an exercise-level drop on all sets creates a sub-set under each; a sub-set row can be removed and edited', async () => {
    const { db, user } = await render((doc) => patch(doc, 0, { sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8 }], techniques: [{ type: 'drop', count: 1, sets: 'all' }] }))
    await confirm(user, bench, 'da série 1', 'série 1', '45', '10')
    expect(bench().getByLabelText('Carga do drop 1 da série 1 (kg)')).toHaveValue('36')
    // No time between the set and its drop.
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()

    // Not doing it: the row goes away and the exercise's rest starts.
    await user.click(bench().getByRole('button', { name: 'Remover drop 1 da série 1' }))
    expect(bench().queryByLabelText('Carga do drop 1 da série 1 (kg)')).not.toBeInTheDocument()
    expect(await screen.findByText('Descanso 01:30')).toBeInTheDocument()

    await confirm(user, bench, 'da série 2', 'série 2', '45', '8')
    await confirm(user, bench, 'do drop 1 da série 2', 'drop 1 da série 2', null, '6')
    await user.click(bench().getByRole('button', { name: 'Editar drop 1 da série 2' }))
    await user.clear(bench().getByLabelText('Repetições do drop 1 da série 2'))
    await user.type(bench().getByLabelText('Repetições do drop 1 da série 2'), '7')
    await user.click(bench().getByRole('button', { name: 'Salvar drop 1 da série 2' }))
    await waitFor(async () => expect((await sessionSets(db)).find((s) => s.kind === 'drop')).toMatchObject({ weightKg: 36, reps: 7 }))
  })

  it('deleting a set removes its sub-sets too', async () => {
    const { db, user } = await render(dropAndRestPause)
    await confirm(user, bench, 'da série 2', 'série 2', '60', '8')
    await confirm(user, bench, 'do rest-pause 1 da série 2', 'rest-pause 1 da série 2', null, '3')
    expect(await sessionSets(db)).toHaveLength(2)

    await user.click(bench().getByRole('button', { name: 'Editar série 2' }))
    await user.click(bench().getByRole('button', { name: 'Excluir série 2' }))

    await waitFor(async () => expect(await sessionSets(db)).toHaveLength(0))
    expect(bench().queryByLabelText(/rest-pause 1 da série 2/)).not.toBeInTheDocument()
    expect(bench().getByRole('button', { name: 'Concluir série 2' })).toBeInTheDocument()
  })

  it('bi-set: one block, A1 → B1 → rest (the longer of the two) → A2, showing who is next', async () => {
    // Only the bench declares it; the pair is mutual.
    const { user } = await render((doc) => {
      patch(doc, 0, { techniques: [{ type: 'biset', with: 'e2' }], restSeconds: 60 })
      patch(doc, 1, { sets: [{ repsMin: 12, repsMax: 15 }, { repsMin: 12, repsMax: 15 }], restSeconds: 75 })
    })
    const block = screen.getByRole('region', { name: 'Bi-set: Supino reto + Crucifixo' })
    expect(within(block).getByRole('region', { name: 'Supino reto' })).toBeInTheDocument()
    expect(within(block).getByRole('region', { name: 'Crucifixo' })).toBeInTheDocument()
    expect(within(block).getByRole('status')).toHaveTextContent('Próximo: A · Supino reto — série 1')

    await confirm(user, bench, 'da série 1', 'série 1', '40', '10')
    expect(screen.queryByText(/^Descanso \d/)).not.toBeInTheDocument()
    expect(within(block).getByRole('status')).toHaveTextContent('Próximo: B · Crucifixo — série 1')

    await user.type(fly().getByLabelText('Carga da série 1 (kg)'), '12')
    await confirm(user, fly, 'da série 1', 'série 1', null, '12')
    expect(await screen.findByText('Descanso 01:15')).toBeInTheDocument()
    expect(screen.getByText('Bi-set: Crucifixo + Supino reto')).toBeInTheDocument()
    expect(within(block).getByRole('status')).toHaveTextContent('Próximo: A · Supino reto — série 2')
  })

  it('skipping an exercise of the bi-set ends the pairing; the other keeps its own rest', async () => {
    const { user } = await render((doc) => patch(doc, 1, { supersetWith: 'e1', restSeconds: 30 }))
    expect(screen.getByRole('region', { name: 'Bi-set: Supino reto + Crucifixo' })).toBeInTheDocument()

    await user.click(fly().getByRole('button', { name: 'Pular exercício' }))
    await user.click(fly().getByRole('button', { name: 'Confirmar pulo' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: /^Bi-set:/ })).not.toBeInTheDocument())
    expect(bench().getByText('Bi-set com Crucifixo desfeito: siga este exercício sozinho.')).toBeInTheDocument()
    await confirm(user, bench, 'da série 1', 'série 1', '40', '10')
    expect(await screen.findByText('Descanso 01:30')).toBeInTheDocument()
  })

  it('SST: the rest after each set follows its intervals', async () => {
    const { user } = await render((doc) => patch(doc, 0, { techniques: [{ type: 'sst', rests: [10, 20] }], restSeconds: 90 }))
    await confirm(user, bench, 'da série 1', 'série 1', '40', '10')
    expect(await screen.findByText('Descanso 00:10')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pular' }))
    await confirm(user, bench, 'da série 2', 'série 2', '40', '8')
    expect(await screen.findByText('Descanso 00:20')).toBeInTheDocument()
  })
})
