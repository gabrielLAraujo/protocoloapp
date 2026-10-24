import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { workoutRepo } from '../../data/workoutRepo'
import { setupApp } from '../testSupport'
import { DuplicateSheet } from './DuplicateSheet'
import { findDuplicates } from './duplicates'
import { BENCH, seedExercises, seedHevySession, seedPastSession, seedPlan } from './testData'

const HEVY = '7d1f2a10-0000-5000-8000-00000000f002'

async function pairOf() {
  const app = await setupApp()
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  const appId = await seedPastSession(app.db, '2026-10-11', BENCH, [[80, 10]])
  await seedHevySession(app.db, HEVY, '2026-10-11', BENCH, [[80, 10]])
  const [pair] = findDuplicates(await workoutRepo.sessionSummaries(app.db, 10, 0))
  return { app, appId, pair: pair! }
}

describe('DuplicateSheet', () => {
  it('"Manter o do Hevy" deletes the app session and reports which one stayed', async () => {
    const { app, appId, pair } = await pairOf()
    const onDone = vi.fn()
    app.view(<DuplicateSheet pair={pair} dayName="Treino A" onDone={onDone} onCancel={() => {}} />)
    expect(screen.getByText(/Treino A de 11\/10/)).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: /Manter o do Hevy/ }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(appId))
    expect(await workoutRepo.sessionById(app.db, appId)).toBeNull()
    expect(await workoutRepo.sessionById(app.db, HEVY)).not.toBeNull()
  })

  it('"Cancelar" deletes nothing', async () => {
    const { app, appId, pair } = await pairOf()
    const onCancel = vi.fn()
    app.view(<DuplicateSheet pair={pair} dayName="Treino A" onDone={() => {}} onCancel={onCancel} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalled()
    expect(await workoutRepo.sessionById(app.db, appId)).not.toBeNull()
  })
})
