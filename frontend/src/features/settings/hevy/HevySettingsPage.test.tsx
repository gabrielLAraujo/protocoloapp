import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json, mockFetch, problem, type Handler } from '../../../test/fetch-mock'
import { setupApp } from '../../testSupport'
import type { HevyStatus } from './hevyApi'
import { HevySettingsPage } from './HevySettingsPage'

// Fictitious key, in the format the plan reserves for tests.
const KEY = 'test-key-0000-0000-0000-000000000001'

const disconnected: HevyStatus = {
  serverConfigured: true,
  connected: false,
  keyLast4: null,
  syncFrom: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
  running: false,
  pendingExercises: 0,
}

const connected: HevyStatus = {
  ...disconnected,
  connected: true,
  keyLast4: '0001',
  syncFrom: '2026-10-01',
}

const syncResult = { imported: 3, updated: 1, deleted: 0, unchanged: 2, skippedNoPlan: 0, skippedSets: 0, pendingExercises: 0 }

async function open(status: HevyStatus, routes: Record<string, Handler> = {}) {
  const calls = mockFetch({ 'GET /api/integrations/hevy': () => json(status), ...routes })
  const app = await setupApp()
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  app.view(<HevySettingsPage />)
  return { ...app, calls, runOnce }
}

describe('HevySettingsPage', () => {
  it('says the server is not configured, without the form', async () => {
    await open({ ...disconnected, serverConfigured: false })

    expect(await screen.findByText('Não configurado no servidor')).toBeInTheDocument()
    expect(screen.queryByLabelText('Chave da API do Hevy')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Conectar' })).not.toBeInTheDocument()
  })

  it('offline: says it needs the internet and calls nothing', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { calls } = await open(connected)

    expect(await screen.findByText(/precisa de internet/)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.startsWith('/api/integrations'))).toHaveLength(0)
  })

  it('connects with a password field, clears it and shows the key ending', async () => {
    const { calls } = await open(disconnected, { 'PUT /api/integrations/hevy': () => json(connected) })

    const field = await screen.findByLabelText('Chave da API do Hevy')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    await userEvent.type(field, KEY)
    await userEvent.type(screen.getByLabelText('Importar a partir de'), '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    expect(await screen.findByText('Conectado · chave terminada em 0001')).toBeInTheDocument()
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(put.body)).toEqual({ apiKey: KEY, syncFrom: '2026-10-01' })
    expect(document.body.innerHTML).not.toContain(KEY)
    expect(screen.getByText('Importando desde 01/10/2026')).toBeInTheDocument()
    expect(screen.getByText('Nunca')).toBeInTheDocument()
  })

  it('shows the 422 message and empties the field', async () => {
    await open(disconnected, {
      'PUT /api/integrations/hevy': () =>
        problem(422, { title: 'Chave recusada', detail: 'O Hevy recusou a chave. Confira a chave e se a conta é Pro.' }),
    })

    const field = await screen.findByLabelText('Chave da API do Hevy')
    await userEvent.type(field, KEY)
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O Hevy recusou a chave. Confira a chave e se a conta é Pro.')
    expect(field).toHaveValue('')
  })

  it('shows the last result, or the last error in pt-BR', async () => {
    await open({ ...connected, lastSuccessAt: new Date(2026, 9, 20, 7, 5).toISOString(), lastResult: syncResult, lastError: 'rate_limited' })

    expect(await screen.findByText('20/10 07:05')).toBeInTheDocument()
    expect(screen.getByText('3 importados, 1 atualizado, 0 removidos')).toBeInTheDocument()
    expect(screen.getByText('O Hevy pediu uma pausa. Tentaremos de novo em 30 minutos.')).toBeInTheDocument()
  })

  it('"Sincronizar agora" runs the pull on the device after the 200', async () => {
    const { runOnce, calls } = await open(connected, {
      'POST /api/integrations/hevy/sync': () => json(syncResult),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByRole('status')).toHaveTextContent('3 importados, 1 atualizado, 0 removidos')
    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/api/integrations/hevy')).toHaveLength(2)
  })

  it('a 409 says a sync is already running, without pulling', async () => {
    const { runOnce } = await open(connected, {
      'POST /api/integrations/hevy/sync': () => problem(409, { title: 'Conflito', detail: 'Sincronização já em andamento.' }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sincronização já em andamento.')
    expect(runOnce).not.toHaveBeenCalled()
  })

  it('"Remover" asks first, then disconnects', async () => {
    const { calls } = await open(connected, { 'DELETE /api/integrations/hevy': () => new Response(null, { status: 204 }) })

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    const dialog = screen.getByRole('dialog', { name: 'Remover a conexão com o Hevy?' })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }))

    expect(await screen.findByLabelText('Chave da API do Hevy')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('"Mudar data inicial" sends the new date', async () => {
    const { calls } = await open(connected, {
      'PATCH /api/integrations/hevy': () => json({ ...connected, syncFrom: '2026-09-15' }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Mudar data inicial' }))
    const dialog = screen.getByRole('dialog', { name: 'Mudar data inicial' })
    const date = within(dialog).getByLabelText('Importar a partir de')
    await userEvent.clear(date)
    await userEvent.type(date, '2026-09-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Importando desde 15/09/2026')).toBeInTheDocument()
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ syncFrom: '2026-09-15' })
  })

  it('"Trocar chave" sends the new key and clears it', async () => {
    const { calls } = await open(connected, {
      'PUT /api/integrations/hevy': () => json({ ...connected, keyLast4: '0002' }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Trocar chave' }))
    const dialog = screen.getByRole('dialog', { name: 'Trocar chave' })
    await userEvent.type(within(dialog).getByLabelText('Chave da API do Hevy'), 'test-key-0000-0000-0000-000000000002')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Conectado · chave terminada em 0002')).toBeInTheDocument()
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ apiKey: 'test-key-0000-0000-0000-000000000002' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('links to the exercises to confirm when there are any', async () => {
    await open({ ...connected, pendingExercises: 2 })

    expect(await screen.findByRole('link', { name: /Exercícios do Hevy para confirmar \(2\)/ })).toHaveAttribute(
      'href',
      '/configuracoes/hevy/exercicios',
    )
  })

  it('no link to confirm when nothing is pending', async () => {
    await open(connected)

    await screen.findByText('Conectado · chave terminada em 0001')
    expect(screen.queryByRole('link', { name: /para confirmar/ })).not.toBeInTheDocument()
  })

  it('says when the status cannot be read, and tries again', async () => {
    let fail = true
    mockFetch({
      'GET /api/integrations/hevy': () => (fail ? problem(500, { title: 'Erro' }) : json(connected)),
    })
    const app = await setupApp()
    app.view(<HevySettingsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor. Tente de novo.')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByText('Conectado · chave terminada em 0001')).toBeInTheDocument()
  })
})
