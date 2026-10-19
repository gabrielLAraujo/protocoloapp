import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { adherenceRepo } from '../../data/adherenceRepo'
import { outbox } from '../../data/outbox'
import type { SyncRecord } from '../../data/apiClient'
import { checkinIdForDate } from '../../data/ids'
import { json, mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
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
    // The check-in and the marks of both parts (which silence the "Check-in da manhã" / "Check-in da noite" reminders).
    await waitFor(async () => expect(await outbox.pendingCount(db)).toBe(3))
    expect(await adherenceRepo.between(db, '2026-10-18', '2026-10-18')).toMatchObject([
      { targetType: 'checkin', targetKey: 'checkin_evening', status: 'done' },
      { targetType: 'checkin', targetKey: 'checkin_morning', status: 'done' },
    ])
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

  it('saves cardio: minutes appear only for Sim, are limited to 300 and are dropped for Não', async () => {
    const { db, view } = await setupApp()
    const user = userEvent.setup()
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })
    await fillAll(user)
    expect(screen.queryByLabelText('Minutos de cardio')).not.toBeInTheDocument()

    await pick(user, 'Cardio feito?', 'Sim')
    await user.type(screen.getByLabelText(/Minutos de cardio/), '301')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Máximo 300 min')).toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()

    await user.clear(screen.getByLabelText(/Minutos de cardio/))
    await user.type(screen.getByLabelText(/Minutos de cardio/), '40')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Salvo — será sincronizado')
    expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ cardioDone: true, cardioMinutes: 40 })
    // "Sim" also marks cardio done for the day (Hoje and the server's cardio reminder read that mark).
    expect((await adherenceRepo.between(db, '2026-10-18', '2026-10-18')).find((l) => l.targetType === 'cardio')).toMatchObject({ status: 'done' })

    await pick(user, 'Cardio feito?', 'Não')
    expect(screen.queryByLabelText('Minutos de cardio')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(async () =>
      expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ cardioDone: false, cardioMinutes: null }),
    )
    expect((await adherenceRepo.between(db, '2026-10-18', '2026-10-18')).find((l) => l.targetType === 'cardio')).toMatchObject({ status: 'missed', reason: null })
  })

  it.each([
    ['done', 'Sim'],
    ['missed', 'Não'],
  ] as const)('prefills cardio from a %s mark on Hoje while the check-in has not answered it', async (status, answer) => {
    const { db, view } = await setupApp()
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-18', targetType: 'cardio', targetKey: 'cardio', status }, new Date())
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })
    expect(within(screen.getByRole('radiogroup', { name: 'Cardio feito?' })).getByRole('radio', { name: answer })).toBeChecked()
  })

  it('a partial cardio mark leaves cardio empty, and an answered check-in wins over the mark', async () => {
    const { db, view } = await setupApp()
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-18', targetType: 'cardio', targetKey: 'cardio', status: 'partial' }, new Date())
    const first = view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })
    for (const radio of within(screen.getByRole('radiogroup', { name: 'Cardio feito?' })).getAllByRole('radio')) expect(radio).not.toBeChecked()
    first.unmount()

    await dailyCheckinRepo.upsert(db, USER_A, '2026-10-18', {
      sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 3, anxiety: 2, waterL: 3, weightKg: null, note: null, cardioDone: false, cardioMinutes: null,
    }, new Date())
    await adherenceRepo.mark(db, USER_A, { date: '2026-10-18', targetType: 'cardio', targetKey: 'cardio', status: 'done' }, new Date())
    view(<DailyCheckinPage />)
    await screen.findByRole('button', { name: 'Salvar' })
    expect(within(screen.getByRole('radiogroup', { name: 'Cardio feito?' })).getByRole('radio', { name: 'Não' })).toBeChecked()
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

  describe('keeps up with other devices and the clock', () => {
    const remote = (note: string, clientUpdatedAt = '2026-10-18T23:00:00.000000+00:00', version = 7): SyncRecord => ({
      entity: 'daily_checkin',
      id: checkinIdForDate(USER_A, '2026-10-18'),
      version,
      payload: {
        date: '2026-10-18',
        sleep_quality: 2,
        bowel: 'constipated',
        energy_wake: 1,
        energy_day: 1,
        anxiety: 5,
        water_l: 3,
        weight_kg: 81,
        note,
      },
      deletedAt: null,
      clientUpdatedAt,
    })

    /** The fake server's pull answers `records` once, then nothing. */
    const serve = (records: SyncRecord[]) => {
      let sent = false
      mockFetch({
        'GET /api/sync/pull': () => {
          const page = sent ? [] : records
          sent = true
          return json({ records: page, nextSince: page.length ? 7 : 0, hasMore: false })
        },
      })
    }

    it('a pull refreshes a form with no unsaved input', async () => {
      const { engine, view } = await setupApp()
      view(<DailyCheckinPage />)
      await screen.findByRole('button', { name: 'Salvar' })
      expect(screen.getByLabelText('Água (litros)')).toHaveValue('')

      serve([remote('do outro aparelho')])
      await act(() => engine.runOnce())

      await waitFor(() => expect(screen.getByLabelText('Água (litros)')).toHaveValue('3'))
      expect(screen.getByLabelText('Observações')).toHaveValue('do outro aparelho')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('a pull never overwrites unsaved input: it offers to reload instead', async () => {
      const { engine, view } = await setupApp()
      const user = userEvent.setup()
      view(<DailyCheckinPage />)
      await screen.findByRole('button', { name: 'Salvar' })
      await user.type(screen.getByLabelText('Observações'), 'digitando')

      serve([remote('do outro aparelho')])
      await act(() => engine.runOnce())

      expect(await screen.findByText('Atualizado em outro aparelho —')).toBeInTheDocument()
      expect(screen.getByLabelText('Observações')).toHaveValue('digitando')

      await user.click(screen.getByRole('button', { name: 'recarregar' }))
      await waitFor(() => expect(screen.getByLabelText('Observações')).toHaveValue('do outro aparelho'))
      expect(screen.queryByText('Atualizado em outro aparelho —')).not.toBeInTheDocument()
    })

    it('does not save over a row that changed since the form loaded it', async () => {
      const { db, view } = await setupApp()
      const user = userEvent.setup()
      view(<DailyCheckinPage />)
      await screen.findByRole('button', { name: 'Salvar' })
      // Written behind the screen's back (no dataVersion bump): only the save-time check can catch it.
      await dailyCheckinRepo.applyRemote(db, remote('do outro aparelho'))

      await fillAll(user)
      await user.click(screen.getByRole('button', { name: 'Salvar' }))

      expect(await screen.findByText('Atualizado em outro aparelho —')).toBeInTheDocument()
      expect(screen.queryByText('Salvo — será sincronizado')).not.toBeInTheDocument()
      expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ note: 'do outro aparelho' })
      expect(await outbox.pendingCount(db)).toBe(0)
    })

    it('saving twice in a row is not mistaken for another device', async () => {
      const { db, view } = await setupApp()
      const user = userEvent.setup()
      view(<DailyCheckinPage />)
      await screen.findByRole('button', { name: 'Salvar' })
      await fillAll(user)
      await user.click(screen.getByRole('button', { name: 'Salvar' }))
      await screen.findByText('Salvo — será sincronizado')

      await user.type(screen.getByLabelText('Observações'), 'mais')
      await user.click(screen.getByRole('button', { name: 'Salvar' }))

      await waitFor(async () => expect(await dailyCheckinRepo.get(db, '2026-10-18')).toMatchObject({ note: 'mais' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    describe('across midnight', () => {
      beforeEach(() => {
        vi.useRealTimers()
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
        vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 58))
      })

      it('switches to the new day at midnight when nothing is being typed', async () => {
        const { view } = await setupApp()
        view(<DailyCheckinPage />)
        await screen.findByText('domingo, 18 de outubro')

        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(await screen.findByText('segunda-feira, 19 de outubro')).toBeInTheDocument()
      })

      it('keeps unsaved input, refuses to save it under the new day and offers to open it', async () => {
        const { db, view } = await setupApp()
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        view(<DailyCheckinPage />)
        await screen.findByText('domingo, 18 de outubro')
        await fillAll(user)

        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(await screen.findByText('O dia mudou — recarregue o check-in')).toBeInTheDocument()
        expect(screen.getByText('domingo, 18 de outubro')).toBeInTheDocument()
        expect(screen.getByLabelText('Água (litros)')).toHaveValue('2,5')

        await user.click(screen.getByRole('button', { name: 'Salvar' }))
        expect(screen.queryByText('Salvo — será sincronizado')).not.toBeInTheDocument()
        expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()
        expect(await dailyCheckinRepo.get(db, '2026-10-19')).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Abrir o check-in de hoje' }))
        expect(await screen.findByText('segunda-feira, 19 de outubro')).toBeInTheDocument()
        expect(screen.getByLabelText('Água (litros)')).toHaveValue('')
      })

      it('a save after midnight is refused even before the timer noticed', async () => {
        const { db, view } = await setupApp()
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        view(<DailyCheckinPage />)
        await screen.findByText('domingo, 18 de outubro')
        await fillAll(user)
        // The clock jumps (device asleep) without the timer firing.
        vi.setSystemTime(new Date(2026, 9, 19, 7, 0))

        await user.click(screen.getByRole('button', { name: 'Salvar' }))

        expect(await screen.findByText('O dia mudou — recarregue o check-in')).toBeInTheDocument()
        expect(await dailyCheckinRepo.get(db, '2026-10-18')).toBeNull()
      })

      it('recomputes the day when the window gets focus', async () => {
        const { view } = await setupApp()
        view(<DailyCheckinPage />)
        await screen.findByText('domingo, 18 de outubro')
        vi.setSystemTime(new Date(2026, 9, 19, 7, 0))

        act(() => {
          window.dispatchEvent(new Event('focus'))
        })

        expect(await screen.findByText('segunda-feira, 19 de outubro')).toBeInTheDocument()
      })
    })
  })
})
