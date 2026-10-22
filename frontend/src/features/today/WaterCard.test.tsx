import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import { checkinParts, dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { outbox } from '../../data/outbox'
import { planVersionSync } from '../../data/planRepo'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { EveningCheckinPage } from '../checkin/EveningCheckinPage'
import { setupApp } from '../testSupport'
import { TodayPage } from './TodayPage'
import { normalizeWater } from './water'

const TODAY = '2026-10-20'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0))
  mockFetch({}) // offline
})
afterEach(() => {
  vi.useRealTimers()
})

/** A fictitious protocol with one meal and, optionally, a minimum of water a day. */
async function seedProtocol(db: LocalDb, waterMinL: number | null) {
  const record: SyncRecord = {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000e1',
    version: 1,
    payload: {
      kind: 'protocol',
      status: 'active',
      document: {
        phaseName: 'Fase teste',
        updateDate: '2026-12-05',
        meals: [{ key: '1', label: 'REF 1', items: [{ food: 'Ovos', grams: 100 }] }],
        items: [],
        cardio: null,
        guidelines: waterMinL === null ? [] : [{ kind: 'water_min_l', value: waterMinL }],
      },
      activated_at: new Date(2026, 9, 15, 12).toISOString(),
      low_confidence: [],
    },
    deletedAt: null,
    clientUpdatedAt: '2026-10-15T12:00:00.000000+00:00',
  }
  await planVersionSync.applyRemote(db, record)
}

async function render({ target = 3.5 as number | null, seed }: { target?: number | null; seed?: (db: LocalDb) => Promise<unknown> } = {}) {
  const app = await setupApp(['/hoje'])
  await seedProtocol(app.db, target)
  await seed?.(app.db)
  const user = userEvent.setup()
  const { router } = app.viewRoutes([
    { path: '/hoje', element: <TodayPage /> },
    { path: '/checkin/noite', element: <EveningCheckinPage /> },
  ])
  await screen.findByRole('region', { name: 'Água' })
  return { ...app, user, router }
}

const card = () => within(screen.getByRole('region', { name: 'Água' }))
const total = () => screen.getByRole('region', { name: 'Água' }).querySelector('[data-water-total]')
const add = (amount: string) => card().getByRole('button', { name: `Adicionar ${amount} de água` })
const stored = async (db: LocalDb) => (await dailyCheckinRepo.get(db, TODAY))?.waterL ?? null

describe('normalizeWater', () => {
  it('rounds to 50 ml and keeps 0–15 L', () => {
    expect(normalizeWater(1.234)).toBe(1.25)
    expect(normalizeWater(0.1 + 0.2)).toBe(0.3)
    expect(normalizeWater(-0.25)).toBe(0)
    expect(normalizeWater(16)).toBe(15)
  })
})

describe('WaterCard on Hoje', () => {
  it('shows the total against the protocol target, with a bar', async () => {
    await render({ seed: (db) => dailyCheckinRepo.changeWater(db, USER_A, TODAY, () => 1.5, new Date()) })

    await waitFor(() => expect(total()).toHaveTextContent('1,5 de 3,5 L'))
    expect(screen.getByRole('region', { name: 'Água' }).querySelector('[data-bar-fill]')).toHaveStyle({ transform: 'scaleX(0.429)' })
    expect(card().queryByLabelText('Meta batida')).not.toBeInTheDocument()
  })

  it('without a protocol target shows only the total', async () => {
    await render({ target: null })

    expect(total()).toHaveTextContent(/^0 L$/)
    expect(screen.getByRole('region', { name: 'Água' }).querySelector('[data-bar-fill]')).toBeNull()
  })

  it('the quick amounts add up, two quick taps included, and reaching the target shows ✓', async () => {
    const { db, user } = await render()

    // Two taps without waiting in between: both are saved, one after the other.
    await Promise.all([user.click(add('250 ml')), user.click(add('250 ml'))])
    await waitFor(async () => expect(await stored(db)).toBe(0.5))
    await user.click(add('500 ml'))
    await user.click(add('1 L'))
    await waitFor(async () => expect(await stored(db)).toBe(2))
    expect(total()).toHaveTextContent('2 de 3,5 L')

    await user.click(add('1 L'))
    await user.click(add('500 ml'))
    await waitFor(async () => expect(await stored(db)).toBe(3.5))
    await waitFor(() => expect(total()).toHaveTextContent('3,5 de 3,5 L'))
    expect(card().getByLabelText('Meta batida')).toBeInTheDocument()
  })

  it('a burst of taps loses no update', async () => {
    const { db, user } = await render()
    const button = add('250 ml')

    for (let i = 0; i < 6; i++) await user.click(button)

    await waitFor(async () => expect(await stored(db)).toBe(1.5))
    await waitFor(() => expect(total()).toHaveTextContent('1,5 de 3,5 L'))
  })

  it('"Ajustar" sets the exact value ("2,5"), and −250 ml never goes below 0', async () => {
    const { db, user } = await render({ seed: (db) => dailyCheckinRepo.changeWater(db, USER_A, TODAY, () => 0.4, new Date()) })
    await waitFor(() => expect(total()).toHaveTextContent('0,4 de 3,5 L'))

    await user.click(card().getByRole('button', { name: 'Ajustar água' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Ajustar água' }))
    const field = sheet.getByLabelText('Total de hoje (litros)')
    expect(field).toHaveValue('0,4')
    await user.click(sheet.getByRole('button', { name: 'Tirar 250 ml' }))
    expect(field).toHaveValue('0,15')
    await user.click(sheet.getByRole('button', { name: 'Tirar 250 ml' }))
    expect(field).toHaveValue('0')

    await user.clear(field)
    await user.type(field, '2,5')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(async () => expect(await stored(db)).toBe(2.5))
    expect(total()).toHaveTextContent('2,5 de 3,5 L')
  })

  it('"Ajustar" refuses an invalid value and over 15 L, and "Cancelar" saves nothing', async () => {
    const { db, user } = await render()

    await user.click(card().getByRole('button', { name: 'Ajustar água' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Ajustar água' }))
    const field = sheet.getByLabelText('Total de hoje (litros)')
    await user.clear(field)
    await user.type(field, '16')
    await user.click(sheet.getByRole('button', { name: 'Salvar' }))
    expect(sheet.getByRole('alert')).toHaveTextContent('Máximo 15 L')

    await user.click(sheet.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await dailyCheckinRepo.get(db, TODAY)).toBeNull()
  })

  it('keeps the rest of the evening check-in and its completeness, and queues the evening part', async () => {
    const { db, user } = await render({
      seed: (db) => dailyCheckinRepo.saveEvening(db, USER_A, TODAY, { energyDay: 4, anxiety: 2, waterL: 1, note: 'Dia de teste' }, new Date()),
    })
    await waitFor(() => expect(total()).toHaveTextContent('1 de 3,5 L'))

    await user.click(add('500 ml'))

    await waitFor(async () => expect(await stored(db)).toBe(1.5))
    const row = await dailyCheckinRepo.get(db, TODAY)
    expect(row).toMatchObject({ energyDay: 4, anxiety: 2, note: 'Dia de teste', waterL: 1.5 })
    expect(checkinParts(row!).evening).toBe(true)
    const pending = await outbox.pendingFor(db, 'daily_checkin', row!.id)
    expect(JSON.parse(pending.at(-1)!.payload!)).toMatchObject({ parts: ['evening'], energy_day: 4, anxiety: 2, water_l: 1.5, note: 'Dia de teste' })
  })

  it('water alone leaves the evening check-in incomplete and the evening form shows the new total', async () => {
    const { db, user, router } = await render()

    await user.click(add('500 ml'))
    await user.click(add('1 L'))
    await waitFor(async () => expect(await stored(db)).toBe(1.5))
    expect(checkinParts((await dailyCheckinRepo.get(db, TODAY))!).evening).toBe(false)

    await act(() => router.navigate('/checkin/noite'))
    await waitFor(() => expect(screen.getByLabelText('Água (litros)')).toHaveValue('1.5'))
  })
})
