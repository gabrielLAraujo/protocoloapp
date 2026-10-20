import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import { adherenceRepo, type AdherenceStatus } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { planVersionSync } from '../../data/planRepo'
import type { WeekGoal } from '../../domain/progress'
import { mockFetch } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { GoalToast } from './Celebration'
import { resetOnceADayForTests } from './onceADay'
import { TodayPage } from './TodayPage'
import { WeekCard } from './WeekCard'

// Tuesday 2026-10-20, late evening: five targets (three meals and both check-in parts), no workout plan, no cardio.
const TODAY = '2026-10-20'

const protocolDocument = {
  phaseName: 'Fase teste',
  updateDate: '2026-11-15',
  meals: [
    { key: '1', label: 'REF 1', items: [{ food: 'Ovos', grams: 100 }] },
    { key: '2', label: 'REF 2', items: [{ food: 'Arroz', grams: 150 }] },
    { key: '3', label: 'REF 3', items: [{ food: 'Frango', grams: 150 }] },
  ],
  items: [],
  cardio: null,
  guidelines: [],
}

async function seedProtocol(db: LocalDb) {
  const record: SyncRecord = {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000e1',
    version: 1,
    payload: { kind: 'protocol', status: 'active', document: protocolDocument, activated_at: new Date(2026, 9, 15, 12).toISOString(), low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-15T12:00:00.000000+00:00',
  }
  await planVersionSync.applyRemote(db, record)
}

async function seedCheckin(db: LocalDb, parts: 'morning' | 'both') {
  await dailyCheckinRepo.saveMorning(db, USER_A, TODAY, { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }, new Date())
  if (parts === 'both') await dailyCheckinRepo.saveEvening(db, USER_A, TODAY, { energyDay: 3, anxiety: 2, waterL: 3, note: null }, new Date())
}

const mark = (db: LocalDb, key: string, status: AdherenceStatus) =>
  adherenceRepo.mark(db, USER_A, { date: TODAY, targetType: 'meal', targetKey: key, status, reason: status === 'done' ? null : 'no_time', note: null }, new Date())

async function setup(seed: (db: LocalDb) => Promise<void> = async () => undefined) {
  const app = await setupApp()
  await seedProtocol(app.db)
  await seed(app.db)
  const user = userEvent.setup()
  const mount = () => app.view(<TodayPage />)
  return { ...app, user, mount }
}

const ring = () => screen.getByRole('progressbar', { name: 'Progresso do dia' })
const row = (name: string) => within(screen.getByRole('listitem', { name }))
const markDone = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(row(name).getByRole('button', { name: 'Feito' }))
  await waitFor(() => expect(row(name).getByRole('button', { name: 'Feito' })).toHaveAttribute('aria-pressed', 'true'))
}

let reducedMotion = false

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 22, 0))
  mockFetch({}) // offline
  resetOnceADayForTests()
  reducedMotion = false
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reducedMotion,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Hoje ring', () => {
  it('shows the share of the whole day done and "N de M"', async () => {
    const { mount } = await setup(async (db) => {
      await seedCheckin(db, 'morning')
      await mark(db, '1', 'partial')
    })
    mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })

    // 1 done + ½ partial of 5 = 30 %.
    expect(ring()).toHaveAttribute('aria-valuenow', '30')
    expect(ring()).toHaveAttribute('aria-valuetext', '30% — 1 de 5 · 1 parcial')
    expect(screen.getByRole('status')).toHaveTextContent('1 de 5 feitos · 1 parcial')
    expect(screen.getByText('Meta do dia: 90%')).toBeInTheDocument()
  })

  it('rises when a target is marked', async () => {
    const { mount, user } = await setup((db) => seedCheckin(db, 'both'))
    mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    expect(ring()).toHaveAttribute('aria-valuenow', '40')

    await markDone(user, 'REF 2')
    expect(ring()).toHaveAttribute('aria-valuenow', '60')
  })

  it('shows the streak, linking to /conquistas', async () => {
    const { mount } = await setup()
    mount()
    const link = await screen.findByRole('link', { name: 'Sequência: 0 dias na meta — ver conquistas' })
    expect(link).toHaveAttribute('href', '/conquistas')
  })
})

describe('Hoje celebration', () => {
  it('fires once when the whole day is done, and not again on re-render or reload', async () => {
    const { mount, user } = await setup(async (db) => {
      await seedCheckin(db, 'both')
      await mark(db, '1', 'done')
      await mark(db, '2', 'done')
    })
    const first = mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()

    await markDone(user, 'REF 3')
    expect(await screen.findByTestId('celebration')).toBeInTheDocument()
    expect(ring()).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('Dia completo')).toBeInTheDocument()
    // Reaching 100 % at once spends the 90 % toast too.
    expect(screen.queryByText('Meta do dia batida')).not.toBeInTheDocument()

    // It goes away after its ~1.5 s and a re-render does not bring it back.
    await waitFor(() => expect(screen.queryByTestId('celebration')).not.toBeInTheDocument(), { timeout: 3000 })
    first.rerenderApp(<TodayPage />)
    await act(() => Promise.resolve())
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()

    // A reload (fresh in-memory state, same storage) on the same day: still complete, no celebration.
    first.unmount()
    resetOnceADayForTests()
    mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    expect(screen.getByText('Dia completo')).toBeInTheDocument()
    await act(() => Promise.resolve())
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()
  })

  it('with reduced motion shows the static "Dia completo" state instead', async () => {
    reducedMotion = true
    const { mount, user } = await setup(async (db) => {
      await seedCheckin(db, 'both')
      await mark(db, '1', 'done')
      await mark(db, '2', 'done')
    })
    mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })

    await markDone(user, 'REF 3')
    expect(await screen.findByText('Dia completo')).toBeInTheDocument()
    await act(() => Promise.resolve())
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()
    // The day is spent: turning motion back on later does not replay it.
    expect(localStorage.getItem('protocolo.onceADay.complete')).toBe(TODAY)
  })

  it('a day already celebrated (stored) does not celebrate on opening', async () => {
    localStorage.setItem('protocolo.onceADay.complete', TODAY)
    const { mount } = await setup(async (db) => {
      await seedCheckin(db, 'both')
      for (const key of ['1', '2', '3']) await mark(db, key, 'done')
    })
    mount()
    expect(await screen.findByText('Dia completo')).toBeInTheDocument()
    await act(() => Promise.resolve())
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()
  })

  it('works without storage (it throws): once per page load', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { mount, user } = await setup(async (db) => {
      await seedCheckin(db, 'both')
      await mark(db, '1', 'done')
      await mark(db, '2', 'done')
    })
    const view = mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    await markDone(user, 'REF 3')
    expect(await screen.findByTestId('celebration')).toBeInTheDocument()
    view.rerenderApp(<TodayPage />)
    await waitFor(() => expect(screen.queryByTestId('celebration')).not.toBeInTheDocument(), { timeout: 3000 })
    vi.restoreAllMocks()
  })
})

/** The toast's live text (the header line "Meta do dia batida" is not a status). */
const toastStatus = () => screen.queryAllByRole('status').find((el) => el.textContent?.includes('Meta do dia batida'))

describe('Hoje 90 % toast', () => {
  it('shows "Meta do dia batida" the first time the day reaches 90 %, once per day', async () => {
    const { mount, user } = await setup(async (db) => {
      await seedCheckin(db, 'both')
      await mark(db, '1', 'done')
      await mark(db, '2', 'partial')
    })
    const first = mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    expect(toastStatus()).toBeUndefined()

    // 4 done + ½ of 5 = 90 %: on target, not complete.
    await markDone(user, 'REF 3')
    await waitFor(() => expect(toastStatus()).toBeDefined())
    expect(toastStatus()).toHaveTextContent('90% do dia feito')
    expect(ring()).toHaveAttribute('aria-valuenow', '90')
    expect(screen.queryByTestId('celebration')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    expect(toastStatus()).toBeUndefined()

    // Dropping below and crossing again the same day: no second toast.
    await user.click(row('REF 3').getByRole('button', { name: 'Feito' }))
    await waitFor(() => expect(ring()).toHaveAttribute('aria-valuenow', '70'))
    await markDone(user, 'REF 3')
    await act(() => Promise.resolve())
    expect(toastStatus()).toBeUndefined()

    // Nor after a reload.
    first.unmount()
    resetOnceADayForTests()
    mount()
    await screen.findByRole('list', { name: 'Itens de hoje' })
    await act(() => Promise.resolve())
    expect(toastStatus()).toBeUndefined()
  })
})

describe('GoalToast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides itself after a few seconds, paused while hovered or focused', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    rtlRender(<GoalToast onClose={onClose} />)
    const close = screen.getByRole('button', { name: 'Fechar aviso' })
    const box = close.parentElement!

    fireEvent.pointerEnter(box)
    act(() => vi.advanceTimersByTime(10_000))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerLeave(box)

    act(() => close.focus())
    act(() => vi.advanceTimersByTime(10_000))
    expect(onClose).not.toHaveBeenCalled()
    act(() => close.blur())

    act(() => vi.advanceTimersByTime(4_400))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Hoje without a plan', () => {
  it('shows no ring: nothing counts toward the day, the counter counts the rows', async () => {
    const app = await setupApp() // no protocol, no workout plan: only the check-in rows
    await seedCheckin(app.db, 'morning')
    app.view(<TodayPage />)
    await screen.findByRole('list', { name: 'Itens de hoje' })
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2 feitos')
    expect(screen.queryByRole('progressbar', { name: 'Progresso do dia' })).not.toBeInTheDocument()
    expect(screen.queryByText('Meta do dia: 90%')).not.toBeInTheDocument()
  })
})

describe('Hoje streak follows the clock', () => {
  it("today joins the streak once its due targets are on target, and leaves it when more become due", async () => {
    // Yesterday fully done; today REF 1 (07:00) and the morning check-in (07:00) are done, REF 2 (10:00) not yet.
    vi.setSystemTime(new Date(2026, 9, 20, 9, 59, 30))
    const { mount } = await setup(async (db) => {
      const y = '2026-10-19'
      const at = new Date(2026, 9, 19, 22)
      for (const key of ['1', '2', '3'])
        await adherenceRepo.mark(db, USER_A, { date: y, targetType: 'meal', targetKey: key, status: 'done', reason: null, note: null }, at)
      await dailyCheckinRepo.saveMorning(db, USER_A, y, { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }, at)
      await dailyCheckinRepo.saveEvening(db, USER_A, y, { energyDay: 3, anxiety: 2, waterL: 3, note: null }, at)
      await seedCheckin(db, 'morning')
      await mark(db, '1', 'done')
    })
    mount()
    // 09:59: everything due is done → today counts: yesterday + today.
    expect(await screen.findByRole('link', { name: /^Sequência: 2 dias/ })).toBeInTheDocument()

    // 10:00 (next clock tick): REF 2 is due and unmarked → 2 of 3 → today is out again, the run so far stays.
    vi.setSystemTime(new Date(2026, 9, 20, 10, 0, 5))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByRole('link', { name: /^Sequência: 1 dia na meta/ })).toBeInTheDocument()
  })
})

describe('Semana card', () => {
  it('lists the week goals on Hoje', async () => {
    const { mount } = await setup((db) => seedCheckin(db, 'both'))
    mount()
    const card = within(await screen.findByRole('region', { name: 'Semana' }))
    expect(card.getByRole('listitem', { name: 'Dieta ≥ 90%' })).toBeInTheDocument()
    // Check-ins: the history starts on 10-15, before this Monday, so all 7 days count; today has both parts.
    expect(within(card.getByRole('listitem', { name: 'Check-ins completos' })).getByText('1 de 7')).toBeInTheDocument()
  })

  it('renders each goal with its value, clamps the bar and checks the done ones', () => {
    const goals: WeekGoal[] = [
      { key: 'diet', label: 'Dieta ≥ 90%', unit: 'percent', progress: 84, target: 90, done: false },
      { key: 'cardio', label: 'Cardio previsto', unit: 'count', progress: 5, target: 4, done: true },
      { key: 'checkins', label: 'Check-ins completos', unit: 'count', progress: 2, target: 7, done: false },
    ]
    rtlRender(<WeekCard goals={goals} />)
    const goal = (name: string) => screen.getByRole('listitem', { name })
    const fill = (name: string) => goal(name).querySelector<HTMLElement>('[data-bar-fill]')!.style.transform

    expect(screen.getByText('1 de 3 metas')).toBeInTheDocument()
    expect(within(goal('Dieta ≥ 90%')).getByText('84%')).toBeInTheDocument()
    expect(fill('Dieta ≥ 90%')).toBe('scaleX(0.84)')
    expect(fill('Cardio previsto')).toBe('scaleX(1)')
    expect(within(goal('Cardio previsto')).getByRole('img', { name: 'Meta batida' })).toBeInTheDocument()
    expect(within(goal('Check-ins completos')).queryByRole('img', { name: 'Meta batida' })).not.toBeInTheDocument()
    expect(fill('Check-ins completos')).toBe('scaleX(0.286)')
  })

  it('renders nothing without goals', () => {
    const { container } = rtlRender(<WeekCard goals={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
