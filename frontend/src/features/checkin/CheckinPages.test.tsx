import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adherenceRepo } from '../../data/adherenceRepo'
import type { SyncRecord } from '../../data/apiClient'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { checkinIdForDate } from '../../data/ids'
import { outbox } from '../../data/outbox'
import { routes } from '../../routes'
import { json, mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { TodayPage } from '../today/TodayPage'
import { CheckinHubPage } from './CheckinHubPage'
import { EveningCheckinPage } from './EveningCheckinPage'
import { MorningCheckinPage } from './MorningCheckinPage'

const DAY = '2026-10-18'

// Local evening of the 18th: in UTC it may already be the 19th, but "today" is the device's calendar day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 22, 30))
  mockFetch({}) // every request fails: the API is offline
})
afterEach(() => {
  vi.useRealTimers()
})

const ROUTES = [
  { path: '/hoje', element: <TodayPage /> },
  { path: '/checkin', element: <CheckinHubPage /> },
  { path: '/checkin/manha', element: <MorningCheckinPage /> },
  { path: '/checkin/noite', element: <EveningCheckinPage /> },
]

async function open(path: string) {
  const app = await setupApp([path])
  const user = userEvent.setup()
  return { ...app, user, mount: () => app.viewRoutes(ROUTES) }
}

type User = ReturnType<typeof userEvent.setup>

const pick = async (user: User, group: string, option: string) => {
  await user.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option }))
}
const checked = (group: string, option: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option })

async function fillMorning(user: User, weight = '') {
  await pick(user, 'Sono (1–5)', '4')
  await pick(user, 'Disposição ao acordar (1–5)', '3')
  await pick(user, 'Intestino', 'Solto')
  if (weight) await user.type(screen.getByLabelText('Peso (kg, opcional)'), weight)
}

async function fillEvening(user: User, water = '2,5') {
  await pick(user, 'Disposição no dia (1–5)', '5')
  await pick(user, 'Ansiedade (1–5)', '2')
  await user.type(screen.getByLabelText('Água (litros)'), water)
}

const marks = async (db: Awaited<ReturnType<typeof setupApp>>['db']) =>
  (await adherenceRepo.between(db, DAY, DAY)).map((l) => [l.targetKey, l.status])

const hojeRow = (name: string) => within(screen.getByRole('listitem', { name }))

describe('/checkin/manha', () => {
  it('saves only the morning, marks its target and goes back to Hoje with a confirmation, the row done', async () => {
    const { db, user, mount } = await open('/checkin/manha')
    const { router } = mount()
    expect(await screen.findByRole('heading', { name: 'Check-in da manhã' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Água (litros)')).not.toBeInTheDocument()
    expect(screen.queryByText(/cardio/i)).not.toBeInTheDocument()

    await fillMorning(user, '82,4')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/hoje'))
    expect(await screen.findByText('Check-in da manhã salvo — será sincronizado')).toBeInTheDocument()
    await waitFor(() => expect(hojeRow('Check-in da manhã').getByText('Feito')).toBeInTheDocument())
    expect(hojeRow('Check-in da noite').queryByText('Feito')).not.toBeInTheDocument()

    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({
      sleepQuality: 4, energyWake: 3, bowel: 'loose', weightKg: 82.4, energyDay: null, anxiety: null, waterL: null, note: null,
    })
    expect(await marks(db)).toEqual([['checkin_morning', 'done']])
  })

  it('asks for the required answers and validates the weight', async () => {
    const { db, user, mount } = await open('/checkin/manha')
    mount()
    await screen.findByRole('button', { name: 'Salvar' })

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findAllByText('Escolha uma opção')).toHaveLength(3)

    await fillMorning(user, '10')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Peso entre 30 e 300 kg')).toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
  })

  it('editing the morning after the evening keeps the evening (and prefills the saved morning)', async () => {
    const { db, user, mount } = await open('/checkin/manha')
    await dailyCheckinRepo.saveMorning(db, USER_A, DAY, { sleepQuality: 2, energyWake: 2, bowel: 'normal', weightKg: 80 }, new Date())
    await dailyCheckinRepo.saveEvening(db, USER_A, DAY, { energyDay: 3, anxiety: 4, waterL: 3, note: 'Noite' }, new Date())
    mount()
    await screen.findByRole('button', { name: 'Salvar' })
    expect(checked('Sono (1–5)', '2')).toBeChecked()
    expect(checked('Intestino', 'Normal')).toBeChecked()
    expect(screen.getByLabelText('Peso (kg, opcional)')).toHaveValue('80')

    await pick(user, 'Sono (1–5)', '5')
    await user.clear(screen.getByLabelText('Peso (kg, opcional)'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await screen.findByText('Check-in da manhã salvo — será sincronizado')
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({
      sleepQuality: 5, weightKg: null, energyDay: 3, anxiety: 4, waterL: 3, note: 'Noite',
    })
  })
})

describe('/checkin/noite', () => {
  it('saves only the evening ("2,5" L), marks its target and goes back to Hoje', async () => {
    const { db, user, mount } = await open('/checkin/noite')
    const { router } = mount()
    expect(await screen.findByRole('heading', { name: 'Check-in da noite' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Sono (1–5)' })).not.toBeInTheDocument()

    await fillEvening(user)
    await user.type(screen.getByLabelText('Observações'), '  Dia leve  ')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/hoje'))
    expect(await screen.findByText('Check-in da noite salvo — será sincronizado')).toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, DAY)).toMatchObject({
      energyDay: 5, anxiety: 2, waterL: 2.5, note: 'Dia leve', sleepQuality: null, energyWake: null, bowel: null,
    })
    expect(await marks(db)).toEqual([['checkin_evening', 'done']])
    // The check-in and the mark.
    expect(await outbox.pendingCount(db)).toBeGreaterThanOrEqual(2)
  })

  it('validates water and the note', async () => {
    const { db, user, mount } = await open('/checkin/noite')
    mount()
    await screen.findByRole('button', { name: 'Salvar' })

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Informe a água em litros')).toBeInTheDocument()
    expect(screen.getAllByText('Escolha uma opção')).toHaveLength(2)

    await fillEvening(user, '20')
    await user.click(screen.getByLabelText('Observações'))
    await user.paste('x'.repeat(2001))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Máximo 15 L')).toBeInTheDocument()
    expect(screen.getByText('Máximo 2000 caracteres')).toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
  })

  describe('keeps up with other devices and the clock', () => {
    const remote = (patch: Record<string, unknown>, version = 7): SyncRecord => ({
      entity: 'daily_checkin',
      id: checkinIdForDate(USER_A, DAY),
      version,
      payload: {
        date: DAY, sleep_quality: null, bowel: null, energy_wake: null, energy_day: 1, anxiety: 5, water_l: 3, weight_kg: null, note: 'do outro aparelho',
        ...patch,
      },
      deletedAt: null,
      clientUpdatedAt: '2026-10-18T23:00:00.000000+00:00',
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
      const { engine, mount } = await open('/checkin/noite')
      mount()
      await screen.findByRole('button', { name: 'Salvar' })

      serve([remote({})])
      await act(() => engine.runOnce())

      await waitFor(() => expect(screen.getByLabelText('Água (litros)')).toHaveValue('3'))
      expect(screen.getByLabelText('Observações')).toHaveValue('do outro aparelho')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('a pull never overwrites unsaved input: it offers to reload instead', async () => {
      const { engine, user, mount } = await open('/checkin/noite')
      mount()
      await screen.findByRole('button', { name: 'Salvar' })
      await user.type(screen.getByLabelText('Observações'), 'digitando')

      serve([remote({})])
      await act(() => engine.runOnce())

      expect(await screen.findByText('Atualizado em outro aparelho —')).toBeInTheDocument()
      expect(screen.getByLabelText('Observações')).toHaveValue('digitando')
      // Saving now would overwrite the other device's version unseen: blocked until the reload.
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'recarregar' }))
      await waitFor(() => expect(screen.getByLabelText('Observações')).toHaveValue('do outro aparelho'))
      expect(screen.queryByText('Atualizado em outro aparelho —')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
    })

    it('a pull that only brings the other part does not disturb the form', async () => {
      const { db, engine, user, mount } = await open('/checkin/noite')
      mount()
      await screen.findByRole('button', { name: 'Salvar' })
      await user.type(screen.getByLabelText('Observações'), 'digitando')

      serve([remote({ sleep_quality: 3, energy_wake: 3, bowel: 'normal', energy_day: null, anxiety: null, water_l: null, note: null })])
      await act(() => engine.runOnce())

      await waitFor(async () => expect((await dailyCheckinRepo.get(db, DAY))?.sleepQuality).toBe(3))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Observações')).toHaveValue('digitando')
    })

    describe('across midnight', () => {
      beforeEach(() => {
        vi.useRealTimers()
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
        vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 58))
      })

      it('switches to the new day at midnight when nothing is being typed', async () => {
        const { mount } = await open('/checkin/noite')
        mount()
        await screen.findByText('domingo, 18 de outubro')

        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(await screen.findByText('segunda-feira, 19 de outubro')).toBeInTheDocument()
      })

      it('keeps unsaved input, refuses to save it under the new day and offers to open it', async () => {
        const { db, mount } = await open('/checkin/noite')
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mount()
        await screen.findByText('domingo, 18 de outubro')
        await fillEvening(user)

        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(await screen.findByText('O dia mudou — recarregue o check-in')).toBeInTheDocument()
        expect(screen.getByLabelText('Água (litros)')).toHaveValue('2,5')
        await user.click(screen.getByRole('button', { name: 'Salvar' }))
        expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
        expect(await dailyCheckinRepo.get(db, '2026-10-19')).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Abrir o check-in de hoje' }))
        expect(await screen.findByText('segunda-feira, 19 de outubro')).toBeInTheDocument()
        expect(screen.getByLabelText('Água (litros)')).toHaveValue('')
      })

      it('a save after midnight is refused even before the timer noticed', async () => {
        const { db, mount } = await open('/checkin/noite')
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mount()
        await screen.findByText('domingo, 18 de outubro')
        await fillEvening(user)
        // The clock jumps (device asleep) without the timer firing.
        vi.setSystemTime(new Date(2026, 9, 19, 7, 0))

        await user.click(screen.getByRole('button', { name: 'Salvar' }))

        expect(await screen.findByText('O dia mudou — recarregue o check-in')).toBeInTheDocument()
        expect(await dailyCheckinRepo.get(db, DAY)).toBeNull()
      })
    })
  })
})

describe('/checkin', () => {
  it('shows both parts pending with "Preencher" links to their screens', async () => {
    const { mount } = await open('/checkin')
    mount()
    expect(await screen.findByRole('heading', { name: 'Check-in de hoje' })).toBeInTheDocument()

    const morning = within(screen.getByRole('listitem', { name: 'Manhã' }))
    expect(morning.getByText('Pendente')).toBeInTheDocument()
    expect(morning.getByText('Sono, disposição ao acordar, intestino e peso')).toBeInTheDocument()
    expect(morning.getByRole('link', { name: 'Preencher check-in da manhã' })).toHaveAttribute('href', '/checkin/manha')
    const evening = within(screen.getByRole('listitem', { name: 'Noite' }))
    expect(evening.getByText('Pendente')).toBeInTheDocument()
    expect(evening.getByRole('link', { name: 'Preencher check-in da noite' })).toHaveAttribute('href', '/checkin/noite')
  })

  it('a saved part shows "Feito" and "Editar"; a cardio-only row leaves both pending', async () => {
    const { db, mount } = await open('/checkin')
    await dailyCheckinRepo.setCardio(db, USER_A, DAY, { done: true, minutes: 30 }, new Date())
    await dailyCheckinRepo.saveEvening(db, USER_A, DAY, { energyDay: 3, anxiety: 2, waterL: 3, note: null }, new Date())
    mount()

    const evening = within(await screen.findByRole('listitem', { name: 'Noite' }))
    expect(evening.getByText('Feito')).toBeInTheDocument()
    expect(evening.getByRole('link', { name: 'Editar check-in da noite' })).toHaveAttribute('href', '/checkin/noite')
    expect(within(screen.getByRole('listitem', { name: 'Manhã' })).getByText('Pendente')).toBeInTheDocument()
  })
})

describe('routes', () => {
  it('Hoje opens each part of the check-in from its row', async () => {
    const { user, mount } = await open('/hoje')
    const { router } = mount()

    await user.click(await screen.findByRole('link', { name: 'Check-in da manhã' }))
    expect(await screen.findByRole('heading', { name: 'Check-in da manhã' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/checkin/manha')

    await act(() => router.navigate('/hoje'))
    await user.click(await screen.findByRole('link', { name: 'Check-in da noite' }))
    expect(await screen.findByRole('heading', { name: 'Check-in da noite' })).toBeInTheDocument()
  })

  it('the app routes hold the hub and both parts', () => {
    const paths = (list: typeof routes): string[] => list.flatMap((r) => [r.path ?? '', ...(r.children ? paths(r.children) : [])])
    expect(paths(routes)).toEqual(expect.arrayContaining(['/checkin', '/checkin/manha', '/checkin/noite']))
  })
})
