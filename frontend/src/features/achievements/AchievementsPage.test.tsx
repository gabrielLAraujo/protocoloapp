import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { AchievementsPage } from './AchievementsPage'
import { GAMI_NOW, seedGamificationHistory } from './testSeed'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(GAMI_NOW)
  mockFetch({})
})

describe('AchievementsPage', () => {
  it('lists the earned medals with their date and the locked ones with their progress', async () => {
    const app = await setupApp()
    await seedGamificationHistory(app.db)
    app.view(<AchievementsPage />)

    expect(await screen.findByRole('heading', { name: 'Conquistas' })).toBeInTheDocument()
    const streak = within(screen.getByRole('region', { name: 'Sequência' }))
    expect(streak.getByText('12 dias na meta')).toBeInTheDocument()
    expect(streak.getByText(/Recorde: 12 dias/)).toBeInTheDocument()

    const earned = within(screen.getByRole('region', { name: 'Conquistadas' }))
    expect(within(earned.getByRole('listitem', { name: 'Semana perfeita' })).getByText('Conquistada em 25/10/2026')).toBeInTheDocument()
    expect(within(earned.getByRole('listitem', { name: 'Sequência de 7 dias' })).getByText('Conquistada em 21/10/2026')).toBeInTheDocument()
    expect(earned.getByRole('listitem', { name: 'Dieta 100% por 7 dias' })).toBeInTheDocument()

    const locked = within(screen.getByRole('region', { name: 'A conquistar' }))
    const s14 = within(locked.getByRole('listitem', { name: 'Sequência de 14 dias' }))
    expect(s14.getByText('12 de 14 dias')).toBeInTheDocument()
    expect(locked.getByRole('listitem', { name: 'Sequência de 14 dias' }).querySelector<HTMLElement>('[data-bar-fill]')!.style.width).toBe('85.7%')
    expect(within(locked.getByRole('listitem', { name: 'Sequência de 30 dias' })).getByText('12 de 30 dias')).toBeInTheDocument()
    // No workout plan: nothing to count yet.
    expect(within(locked.getByRole('listitem', { name: 'Todos os treinos do ciclo' })).getByText('—')).toBeInTheDocument()
    expect(screen.getByText(`3 de 6 medalhas`)).toBeInTheDocument()
  })

  it('with no history everything is locked', async () => {
    const app = await setupApp()
    app.view(<AchievementsPage />)

    expect(await screen.findByRole('heading', { name: 'Conquistas' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Conquistadas' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'A conquistar' })).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('0 dias na meta')).toBeInTheDocument()
  })
})
