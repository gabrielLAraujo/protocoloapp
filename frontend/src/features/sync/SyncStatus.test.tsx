import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dailyCheckinRepo, type MorningFields } from '../../data/dailyCheckinRepo'
import { outbox } from '../../data/outbox'
import { json, mockFetch } from '../../test/fetch-mock'
import { syncState } from '../../data/syncState'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { AttentionList } from './AttentionList'
import { SyncStatus } from './SyncStatus'

afterEach(() => {
  vi.useRealTimers()
})

const fields: MorningFields = { sleepQuality: 4, bowel: 'normal', energyWake: 3, weightKg: null }
const at = new Date('2026-10-18T12:00:00Z')

describe('SyncStatus', () => {
  it('shows "Sincronizado" when nothing is pending after a complete run', async () => {
    mockFetch({})
    const { db, view } = await setupApp()
    await syncState.set(db, 'last_sync_at', '2026-10-18T12:00:00.000Z')
    view(<SyncStatus />)
    expect(await screen.findByText('Sincronizado')).toBeInTheDocument()
  })

  it('keeps a calm state for screen readers only and shows the text when something is pending', async () => {
    mockFetch({})
    const { db, view } = await setupApp()
    await syncState.set(db, 'last_sync_at', '2026-10-18T12:00:00.000Z')
    view(<SyncStatus />)
    expect(await screen.findByRole('status')).toHaveTextContent('Sincronizado')
    expect(screen.getByRole('status')).toHaveClass('sr-only')
    await dailyCheckinRepo.saveMorning(db, USER_A, '2026-10-17', fields, at)
    view(<SyncStatus />)
    const pending = await screen.findByText('1 pendente')
    expect(pending).toHaveAttribute('role', 'status')
    expect(pending).not.toHaveClass('sr-only')
  })

  it('shows "Nunca sincronizado" before the first complete run', async () => {
    mockFetch({})
    const { view } = await setupApp()
    view(<SyncStatus />)
    expect(await screen.findByText('Nunca sincronizado')).toBeInTheDocument()
    expect(screen.queryByText('Sincronizado')).not.toBeInTheDocument()
  })

  it('shows "Erro ao sincronizar" when the last run failed, even after an earlier success', async () => {
    mockFetch({
      'POST /api/sync/push': () => new Response(null, { status: 503 }),
      'GET /api/sync/pull': () => json({ records: [], nextSince: 0, hasMore: false }),
    })
    const { db, engine, view } = await setupApp()
    await syncState.set(db, 'last_sync_at', '2026-10-18T12:00:00.000Z')
    await dailyCheckinRepo.saveMorning(db, USER_A, '2026-10-17', fields, at)
    view(<SyncStatus />)
    await engine.runOnce()
    expect(await screen.findByText('Erro ao sincronizar — 1 pendente')).toBeInTheDocument()
  })

  it('shows "Erro ao sincronizar" when the server cannot be reached', async () => {
    mockFetch({}) // every request fails like a dropped connection
    const { engine, view } = await setupApp()
    view(<SyncStatus />)
    await engine.runOnce()
    expect(await screen.findByText('Erro ao sincronizar')).toBeInTheDocument()
  })

  it.each([
    [1, '1 pendente'],
    [2, '2 pendentes'],
  ])('shows the pending count (%i)', async (count, text) => {
    mockFetch({})
    const { db, view } = await setupApp()
    for (let day = 0; day < count; day++) await dailyCheckinRepo.saveMorning(db, USER_A, `2026-10-1${day}`, fields, at)
    view(<SyncStatus />)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('says offline with the pending count when the device has no network', async () => {
    mockFetch({})
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { db, view } = await setupApp()
    await dailyCheckinRepo.saveMorning(db, USER_A, '2026-10-17', fields, at)
    view(<SyncStatus />)
    expect(await screen.findByText('Offline — 1 pendente')).toBeInTheDocument()
  })

  it('shows attention badge when there are rejected entries', async () => {
    mockFetch({})
    const { db, view } = await setupApp()
    await syncState.set(db, 'last_sync_at', '2026-10-18T12:00:00.000Z')
    await dailyCheckinRepo.saveMorning(db, USER_A, '2026-10-17', fields, at)
    const [entry] = await db.query<{ seq: number }>('SELECT seq FROM outbox')
    await outbox.reject(db, entry!.seq, ['date_conflict'])

    view(<SyncStatus />)

    const badge = await screen.findByRole('link', { name: '1 com problema' })
    expect(badge).toHaveAttribute('href', '/sync')
    expect(screen.getByText('Sincronizado')).toBeInTheDocument()
  })

  it('"Sincronizar agora" runs a sync and shows progress', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch({
      'POST /api/sync/push': async (call) => {
        await held
        const { changes } = JSON.parse(call.body) as { changes: { id: string }[] }
        return json({ results: changes.map((c) => ({ id: c.id, status: 'applied', errors: null })) })
      },
      'GET /api/sync/pull': () => json({ records: [], nextSince: 0, hasMore: false }),
    })
    const { db, view } = await setupApp()
    await dailyCheckinRepo.saveMorning(db, USER_A, '2026-10-17', fields, at)
    const user = userEvent.setup()
    view(<SyncStatus />)

    await user.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))
    expect(await screen.findByText('Sincronizando…')).toBeInTheDocument()
    release()
    expect(await screen.findByText('Sincronizado')).toBeInTheDocument()
    expect(await outbox.pendingCount(db)).toBe(0)
  })
})

describe('AttentionList', () => {
  async function seedRejected(errors: string[]) {
    const app = await setupApp()
    await dailyCheckinRepo.saveMorning(app.db, USER_A, '2026-10-17', fields, at)
    const [entry] = await app.db.query<{ seq: number }>('SELECT seq FROM outbox')
    await outbox.reject(app.db, entry!.seq, errors)
    return app
  }

  it('lists each error in pt-BR', async () => {
    mockFetch({})
    const { view } = await seedRejected([
      'client_updated_at_in_future',
      'date_conflict',
      'invalid_payload:water_l',
      'forbidden',
      'invalid_request',
      'unknown_entity',
      'something_new',
    ])
    view(<AttentionList />)

    expect(await screen.findByText('O relógio do aparelho está adiantado. Ajuste a hora e tente de novo.')).toBeInTheDocument()
    expect(screen.getByText('Já existe um check-in para esse dia.')).toBeInTheDocument()
    expect(screen.getByText('Valor inválido em Água')).toBeInTheDocument()
    expect(screen.getByText('Sem permissão para esse registro.')).toBeInTheDocument()
    expect(screen.getByText('O servidor recusou esse registro.')).toBeInTheDocument()
    expect(screen.getByText('Tipo de registro desconhecido.')).toBeInTheDocument()
    expect(screen.getByText('Erro ao sincronizar.')).toBeInTheDocument()
    expect(screen.getByText(/Check-in de 17\/10\/2026/)).toBeInTheDocument()
  })

  it('"Tentar de novo" puts the entry back in the queue', async () => {
    mockFetch({})
    const { db, view } = await seedRejected(['client_updated_at_in_future'])
    const user = userEvent.setup()
    view(<AttentionList />)

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))

    await waitFor(() => expect(screen.getByText('Nada com problema.')).toBeInTheDocument())
    expect(await outbox.rejectedCount(db)).toBe(0)
    expect(await outbox.pendingCount(db)).toBe(1)
  })

  it('says so when nothing needs attention', async () => {
    mockFetch({})
    const { view } = await setupApp()
    view(<AttentionList />)
    expect(await screen.findByText('Nada com problema.')).toBeInTheDocument()
  })
})
