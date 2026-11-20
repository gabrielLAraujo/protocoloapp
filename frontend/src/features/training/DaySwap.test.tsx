import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { seedPlan } from '../workout/testData'
import { loadWorkoutPlans } from '../workout/workoutPlans'
import { DaySwap } from './DaySwap'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0))
  mockFetch({}) // offline
})

async function open(onChanged: () => Promise<void>) {
  const app = await setupApp(['/treino'])
  await seedPlan(app.db, ['a', 'b'])
  const plans = await loadWorkoutPlans(app.db)
  app.view(<DaySwap data={{ db: app.db, userId: USER_A, engine: app.engine }} today="2026-10-18" plans={plans} overrides={[]} onChanged={onChanged} />)
  return { ...app, user: userEvent.setup() }
}

describe('DaySwap', () => {
  it('a swap saved whose screen reload fails does not say the swap failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, user } = await open(() => Promise.reject(new Error('reload failed')))

    await user.click(await screen.findByRole('button', { name: 'Trocar' }))
    await user.click(screen.getByRole('button', { name: /Treino B/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Treino de hoje trocado, mas não foi possível atualizar a tela.')
    expect(screen.queryByText('Não foi possível trocar o treino de hoje.')).not.toBeInTheDocument()
    expect((await rotationOverrideRepo.between(db, '2026-10-18', '2026-10-18')).map((o) => o.dayKey)).toEqual(['b'])
  })

  it('a swap that could not be saved says so and keeps the list open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(rotationOverrideRepo, 'set').mockRejectedValueOnce(new Error('write failed'))
    const { user } = await open(() => Promise.resolve())

    await user.click(await screen.findByRole('button', { name: 'Trocar' }))
    await user.click(screen.getByRole('button', { name: /Treino B/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível trocar o treino de hoje.')
    expect(screen.getByRole('region', { name: 'Trocar o treino de hoje' })).toBeInTheDocument()
  })
})
