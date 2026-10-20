import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { planVersionSync } from '../../data/planRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { mockFetch } from '../../test/fetch-mock'
import { ACTIVE_ID, protocolDocument } from '../plans/fixtures'
import { setupApp } from '../testSupport'
import { SchedulePage, SYNC_DEBOUNCE_MS } from './SchedulePage'

const protocolWithTimings = () => ({
  ...protocolDocument(),
  meals: [
    { key: 'm1', label: 'Café da manhã', items: [] },
    { key: 'm2', label: ' ', items: [] },
  ],
  items: [{ key: 'i1', category: 'supplement', name: 'Suplemento fictício', timing: 'intra_workout', schedule: { type: 'daily' } }],
})

async function open(doc: unknown = protocolWithTimings()) {
  mockFetch({})
  const app = await setupApp()
  await planVersionSync.applyRemote(app.db, {
    entity: 'plan_version',
    id: ACTIVE_ID,
    version: 1,
    payload: { kind: 'protocol', status: 'active', document: doc, activated_at: '2026-10-10T15:00:00.000Z', low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
  })
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  app.view(<SchedulePage />)
  await screen.findByRole('heading', { name: 'Horários' })
  return { ...app, runOnce }
}

const section = (name: 'Dia de treino' | 'Descanso') => within(screen.getByRole('region', { name }))
const time = (label: string) => screen.getByLabelText(`Horário de ${label}`)
const reminder = (label: string) => screen.getByLabelText(`Lembrete de ${label}`)
/** Types a time and leaves the field, as closing the picker does: the time is saved on leaving. */
const enterTime = (label: string, value: string) => {
  const input = time(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe('SchedulePage', () => {
  it('shows the suggested times of the active protocol, for training and rest days', async () => {
    const { runOnce } = await open()

    expect(time('Café da manhã (dia de treino)')).toHaveValue('07:00')
    expect(time('REF 2 (dia de treino)')).toHaveValue('10:00')
    expect(time('Em jejum (descanso)')).toHaveValue('06:30')
    expect(time('Treino (descanso)')).toHaveValue('18:00')
    expect(time('Check-in da noite (dia de treino)')).toHaveValue('21:30')
    expect(time('Check-in da manhã (descanso)')).toHaveValue('07:00')
    expect(reminder('Antes de dormir (descanso)')).toBeChecked()
    // Only because the protocol has an intra-workout item; no suggested time, so no reminder yet.
    expect(time('Intra-treino (dia de treino)')).toHaveValue('')
    expect(reminder('Intra-treino (dia de treino)')).toBeDisabled()
    expect(screen.queryByLabelText(/Após refeição/)).not.toBeInTheDocument()
    expect(section('Dia de treino').getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual([
      'Em jejum',
      'Check-in da manhã',
      'Café da manhã',
      'REF 2',
      'Cardio',
      'Pré-treino',
      'Intra-treino',
      'Treino',
      'Pós-treino',
      'Antes de dormir',
      'Check-in da noite',
    ])
    // The defaults were created on the device and sent.
    await waitFor(() => expect(runOnce).toHaveBeenCalled())
  })

  it('saves an edited time and a reminder turned off, and syncs', async () => {
    const { db, runOnce } = await open()
    await waitFor(() => expect(runOnce).toHaveBeenCalled()) // the defaults' sync
    runOnce.mockClear()

    enterTime('REF 2 (descanso)', '11:15')
    expect(await screen.findByText('Salvo.')).toBeInTheDocument()
    await userEvent.click(reminder('Cardio (dia de treino)'))

    await waitFor(async () => {
      const slots = await scheduleRepo.all(db)
      expect(slots.find((s) => s.slot === 'meal_m2' && s.dayType === 'off')).toMatchObject({ time: '11:15', reminderEnabled: true })
      expect(slots.find((s) => s.slot === 'cardio' && s.dayType === 'training')).toMatchObject({ time: '07:30', reminderEnabled: false })
    })
    // Untouched: the training-day REF 2.
    expect(time('REF 2 (dia de treino)')).toHaveValue('10:00')
    expect(reminder('Cardio (dia de treino)')).not.toBeChecked()
    // A real clock, not the defaults' fixed timestamp: the edit wins on the server.
    const edited = (await scheduleRepo.all(db)).find((s) => s.slot === 'meal_m2' && s.dayType === 'off')!
    expect(edited.clientUpdatedAt > '2026-01-01').toBe(true)
    // Both edits go to the server in one debounced sync.
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1), { timeout: 3000 })
    await new Promise((resolve) => setTimeout(resolve, SYNC_DEBOUNCE_MS + 200))
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('does not save while a time is being typed, only when the field is left', async () => {
    const { db } = await open()
    const input = time('Cardio (descanso)')

    fireEvent.change(input, { target: { value: '08:00' } })
    fireEvent.change(input, { target: { value: '08:05' } })

    expect(input).toHaveValue('08:05')
    expect((await scheduleRepo.all(db)).find((s) => s.slot === 'cardio' && s.dayType === 'off')?.time).toBe('07:30')
    fireEvent.blur(input)
    await waitFor(async () => {
      expect((await scheduleRepo.all(db)).find((s) => s.slot === 'cardio' && s.dayType === 'off')?.time).toBe('08:05')
    })
    expect(time('Cardio (descanso)')).toHaveValue('08:05')
  })

  it('a cleared time goes back to the saved one when the field is left', async () => {
    const { db } = await open()
    const input = time('Cardio (descanso)')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(input).toHaveValue('07:30')
    expect((await scheduleRepo.all(db)).find((s) => s.slot === 'cardio' && s.dayType === 'off')?.time).toBe('07:30')
  })

  it('a slot without a time gets one, with its reminder on', async () => {
    const { db } = await open()

    enterTime('Intra-treino (dia de treino)', '18:30')

    await waitFor(() => expect(reminder('Intra-treino (dia de treino)')).toBeChecked())
    const slots = await scheduleRepo.all(db)
    expect(slots.find((s) => s.slot === 'intra_workout')).toMatchObject({ dayType: 'training', time: '18:30', reminderEnabled: true })
  })

  it('"Copiar do dia de treino" copies every training-day time and reminder to rest days', async () => {
    const { db } = await open()
    enterTime('Café da manhã (dia de treino)', '06:45')
    await screen.findByText('Salvo.')
    await userEvent.click(reminder('Check-in da noite (dia de treino)'))
    await waitFor(() => expect(reminder('Check-in da noite (dia de treino)')).not.toBeChecked())

    await userEvent.click(screen.getByRole('button', { name: 'Copiar do dia de treino' }))

    expect(await screen.findByText('Horários do dia de treino copiados para o descanso.')).toBeInTheDocument()
    expect(time('Café da manhã (descanso)')).toHaveValue('06:45')
    expect(reminder('Check-in da noite (descanso)')).not.toBeChecked()
    const slots = await scheduleRepo.all(db)
    for (const training of slots.filter((s) => s.dayType === 'training')) {
      expect(slots.find((s) => s.slot === training.slot && s.dayType === 'off')).toMatchObject({
        time: training.time,
        reminderEnabled: training.reminderEnabled,
      })
    }
  })

  it('without an active protocol shows the fixed slots only', async () => {
    mockFetch({})
    const app = await setupApp()
    vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
    app.view(<SchedulePage />)

    expect(await screen.findByLabelText('Horário de Cardio (dia de treino)')).toHaveValue('07:30')
    expect(screen.queryByLabelText(/REF/)).not.toBeInTheDocument()
    expect(await scheduleRepo.all(app.db)).toHaveLength(16)
  })
})
