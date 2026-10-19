import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import { planVersionSync } from '../../data/planRepo'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { ACTIVE_ID, FILE_ID, PLAN_ID, protocolDocument, workoutDocument } from './fixtures'
import { PlansPage } from './PlansPage'

const planRecord = (id: string, kind: string, status: string, document: unknown, activatedAt: string | null): SyncRecord => ({
  entity: 'plan_version',
  id,
  version: 1,
  payload: { kind, status, document, activated_at: activatedAt, low_confidence: [] },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

const pdf = () => new File(['%PDF-1.4 fake'], 'ficha.pdf', { type: 'application/pdf' })

const routes = (importHandler: () => Response | Promise<Response>) => ({
  'POST /api/files/upload-url': () => json({ fileId: FILE_ID, uploadUrl: 'http://storage.test/up', expiresAt: '2026-10-18T12:00:00Z' }),
  'PUT /up': () => new Response(null, { status: 200 }),
  [`POST /api/files/${FILE_ID}/confirm`]: () => new Response(null, { status: 204 }),
  'POST /api/plans/import': importHandler,
})

async function renderPage() {
  const app = await setupApp()
  await planVersionSync.applyRemote(app.db, planRecord(ACTIVE_ID, 'protocol', 'active', protocolDocument(), '2026-10-10T15:00:00.000Z'))
  await planVersionSync.applyRemote(app.db, planRecord('7d1f2a10-0000-5000-8000-0000000000b2', 'workout', 'active', workoutDocument(), '2026-10-12T15:00:00.000Z'))
  app.view(
    <Routes>
      <Route path="/" element={<PlansPage />} />
      <Route path="/planejamento/revisao/:id" element={<p>TELA DE REVISÃO</p>} />
    </Routes>,
  )
  return app
}

afterEach(() => vi.restoreAllMocks())

const card = (name: string) => within(screen.getByRole('region', { name }))

describe('PlansPage', () => {
  it('shows the protocol and workout cards with phase, update date and active since', async () => {
    mockFetch({})
    await renderPage()

    expect(await screen.findByRole('heading', { name: 'Protocolo' })).toBeInTheDocument()
    expect(card('Protocolo').getByText('Fase 2')).toBeInTheDocument()
    expect(card('Protocolo').getByText('Atualização em 20/11')).toBeInTheDocument()
    expect(card('Protocolo').getByText('Ativo desde 10/10')).toBeInTheDocument()
    expect(card('Treino').getByText('2 dias de treino')).toBeInTheDocument()
    expect(card('Treino').getByText('Ativo desde 12/10')).toBeInTheDocument()
    expect(card('Protocolo').getByRole('link', { name: 'Ver protocolo' })).toHaveAttribute('href', '/planejamento/protocolo')
  })

  it('sending a PDF shows "Lendo o PDF…", blocks a second import and opens the review', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => (finish = resolve))
    const calls = mockFetch(routes(async () => (await gate, json({ id: PLAN_ID }, 201))))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Treino' })

    await user.upload(card('Treino').getByLabelText('Enviar novo PDF'), pdf())

    expect(await card('Treino').findByText(/Lendo o PDF…/)).toBeInTheDocument()
    expect(card('Treino').getByText(/até 90 segundos/)).toBeInTheDocument()
    expect(card('Treino').getByLabelText('Enviar novo PDF')).toBeDisabled()
    expect(card('Protocolo').getByLabelText('Enviar novo PDF')).toBeDisabled()

    finish()
    expect(await screen.findByText('TELA DE REVISÃO')).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/api/plans/import')).toHaveLength(1)
  })

  it('an unavailable import shows the message and allows trying again', async () => {
    mockFetch(routes(() => problem(503, { title: 'Importação indisponível' })))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    await user.upload(card('Protocolo').getByLabelText('Enviar novo PDF'), pdf())

    expect(await card('Protocolo').findByRole('alert')).toHaveTextContent('Importação indisponível no momento.')
    await waitFor(() => expect(card('Protocolo').getByLabelText('Enviar novo PDF')).toBeEnabled())
  })

  it('a PDF that is too big shows the size message', async () => {
    mockFetch(routes(() => problem(413, { title: 'Grande' })))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    await user.upload(card('Protocolo').getByLabelText('Enviar novo PDF'), pdf())

    expect(await card('Protocolo').findByRole('alert')).toHaveTextContent('PDF grande demais (máx. 20 MB).')
  })

  it('offline: says to connect and does not allow sending', async () => {
    mockFetch({})
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    expect(screen.getByText('Conecte-se à internet para importar')).toBeInTheDocument()
    expect(card('Protocolo').getByLabelText('Enviar novo PDF')).toBeDisabled()
    expect(card('Treino').getByLabelText('Enviar novo PDF')).toBeDisabled()
  })

  it('a connection lost mid-import shows the connect message', async () => {
    mockFetch({}) // the first request already fails
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    await user.upload(card('Protocolo').getByLabelText('Enviar novo PDF'), pdf())

    expect(await card('Protocolo').findByRole('alert')).toHaveTextContent('Conecte-se à internet para importar')
  })

  it('a draft on the device offers to resume the review', async () => {
    mockFetch({})
    const app = await setupApp()
    await planVersionSync.applyRemote(app.db, planRecord(PLAN_ID, 'workout', 'draft', workoutDocument(), null))
    app.view(<PlansPage />)

    const link = await within(await screen.findByRole('region', { name: 'Treino' })).findByRole('link', { name: 'Revisar rascunho' })
    expect(link).toHaveAttribute('href', `/planejamento/revisao/${PLAN_ID}`)
  })
})
