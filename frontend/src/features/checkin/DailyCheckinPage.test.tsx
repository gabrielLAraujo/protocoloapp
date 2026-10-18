import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { outbox } from '../../data/outbox'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { DailyCheckinPage } from './DailyCheckinPage'

// Local evening of the 18th: in UTC it may already be the 19th, but "today" is the device's calendar day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 22, 30))
  mockFetch({}) // every request fails: the API is offline
})
afterEach(() => {
  vi.useRealTimers()
})

const pick = async (user: ReturnType<typeof userEvent.setup>, group: string, option: string) => {
  const radios = screen.getByRole('radiogroup', { name: group })
  await user.click(within(radios).getByRole('radio', { name: option }))
}

async function fillAll(user: ReturnType<typeof userEvent.setup>, water = '2,5') {
  await pick(user, 'Sono (1–5)', '4')
  await pick(user, 'Intestino', 'Solto')
  await pick(user, 'Disposição ao acordar (1–5)', '3')
  await pick(user, 'Disposição no dia (1–5)', '5')
  await pick(user, 'Ansiedade (1–5)', '2')
  await user.type(screen.getByLabelText('Água (litros)'), water)
}

describe('DailyCheckinPage', () => {
  it("saves today's checkin locally and shows \"Salvo — será sincronizado\"", async () => {
    const { db, view } = await setupApp()
    const user = userEvent.setup()
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })

    await fillAll(user)
    await user.type(screen.getByLabelText('Peso (kg, opcional)'), '82,4')
    await user.type(screen.getByLabelText('Observações'), 'Dormi bem')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Salvo — será sincronizado')).toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({
      sleepQuality: 4,
      bowel: 'loose',
      energyWake: 3,
      energyDay: 5,
      anxiety: 2,
      waterL: 2.5,
      weightKg: 82.4,
      note: 'Dormi bem',
    })
    await waitFor(async () => expect(await outbox.pendingCount(db)).toBe(1))
  })

  it('reopening the page loads the saved values', async () => {
    const { view } = await setupApp()
    const user = userEvent.setup()
    const first = view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })
    await fillAll(user)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Salvo — será sincronizado')
    first.unmount()

    view(<DailyCheckinPage />)

    await waitFor(() => expect(screen.getByLabelText('Água (litros)')).toHaveValue('2.5'))
    expect(within(screen.getByRole('radiogroup', { name: 'Sono (1–5)' })).getByRole('radio', { name: '4' })).toBeChecked()
    expect(within(screen.getByRole('radiogroup', { name: 'Intestino' })).getByRole('radio', { name: 'Solto' })).toBeChecked()
    expect(screen.getByLabelText('Peso (kg, opcional)')).toHaveValue('')
  })

  it('validates ranges', async () => {
    const { db, view } = await setupApp()
    const user = userEvent.setup()
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })

    await fillAll(user, '20')
    await user.type(screen.getByLabelText('Peso (kg, opcional)'), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Máximo 15 L')).toBeInTheDocument()
    expect(screen.getByText('Peso entre 30 e 300 kg')).toBeInTheDocument()
    expect(screen.queryByText('Salvo — será sincronizado')).not.toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()
  })

  it('asks for the required answers', async () => {
    const { view } = await setupApp()
    const user = userEvent.setup()
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Informe a água em litros')).toBeInTheDocument()
    expect(screen.getAllByText('Escolha uma opção')).toHaveLength(5)
  })
})
