import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRecord } from '../../data/apiClient'
import { planVersionSync } from '../../data/planRepo'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { ACTIVE_ID, FILE_ID, PLAN_ID, protocolDocument, workoutDocument } from './fixtures'
import * as pdfText from './pdf/pdfText'
import type { PdfLine } from './pdf/pdfText'
import { PlansPage } from './PlansPage'

vi.mock('./pdf/pdfText', () => ({ extractPdfLines: vi.fn() }))

// Invented sheet lines: what pdf.js would give for a fictitious workout PDF.
const sheet = (...texts: string[]): PdfLine[] => texts.map((text, i) => ({ page: 1, y: 800 - i * 14, items: [{ x: 72, text }], text }))
const workoutSheet = () => sheet('(grupo um) 3x 8 a 12', '- Movimento alfa (2x9 a 11) (intervalo 2 min)', 'DESCANSO')

function ReviewStub() {
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  return <p>TELA DE REVISÃO{notice ? ` · ${notice}` : ''}</p>
}

const planRecord = (id: string, kind: string, status: string, document: unknown, activatedAt: string | null): SyncRecord => ({
  entity: 'plan_version',
  id,
  version: 1,
  payload: { kind, status, document, activated_at: activatedAt, low_confidence: [] },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

const pdf = () => new File(['%PDF-1.4 fake'], 'ficha.pdf', { type: 'application/pdf' })

const routes = (draftHandler: () => Response | Promise<Response>) => ({
  'POST /api/files/upload-url': () => json({ fileId: FILE_ID, uploadUrl: 'http://storage.test/up', expiresAt: '2026-10-18T12:00:00Z' }),
  'PUT /up': () => new Response(null, { status: 200 }),
  [`POST /api/files/${FILE_ID}/confirm`]: () => new Response(null, { status: 204 }),
  'POST /api/plans/drafts': draftHandler,
})

async function renderPage() {
  const app = await setupApp()
  await planVersionSync.applyRemote(app.db, planRecord(ACTIVE_ID, 'protocol', 'active', protocolDocument(), '2026-10-10T15:00:00.000Z'))
  await planVersionSync.applyRemote(app.db, planRecord('7d1f2a10-0000-5000-8000-0000000000b2', 'workout', 'active', workoutDocument(), '2026-10-12T15:00:00.000Z'))
  app.view(
    <Routes>
      <Route
        path="/"
        element={
          <>
            <PlansPage />
            <Link to="/outra">Ir para outra tela</Link>
          </>
        }
      />
      <Route path="/outra" element={<p>OUTRA TELA</p>} />
      <Route path="/planejamento/revisao/:id" element={<ReviewStub />} />
    </Routes>,
  )
  return app
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.mocked(pdfText.extractPdfLines).mockResolvedValue(workoutSheet()))

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

  it('lays the card actions out as the upload across the card and the others in equal halves below', async () => {
    mockFetch({})
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    const actions = (name: string) => screen.getByRole('region', { name }).querySelector('[data-plan-actions]')!
    // The upload is the first cell (it spans both columns); the rest follow in order.
    expect(Array.from(actions('Protocolo').children).map((el) => el.textContent)).toEqual(['Enviar novo PDF', 'Ver protocolo', 'Editar datas'])
    expect(actions('Protocolo').className).toMatch(/grid-cols-2/)
    expect(actions('Protocolo').className).toMatch(/\[&>\*:first-child\]:col-span-2/)
    // An odd one out (here the workout has only the upload) still fills the row.
    expect(Array.from(actions('Treino').children).map((el) => el.textContent)).toEqual(['Enviar novo PDF'])
    // The dates form opens under the actions, not among them.
    await user.click(card('Protocolo').getByRole('button', { name: 'Editar datas' }))
    expect(actions('Protocolo').children).toHaveLength(3)
  })

  it('sending a PDF reads it on the device, shows "Lendo o PDF…", blocks a second import and opens the review', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => (finish = resolve))
    const calls = mockFetch(routes(async () => (await gate, json({ planVersionId: PLAN_ID }, 201))))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Treino' })

    await user.upload(card('Treino').getByLabelText('Enviar novo PDF'), pdf())

    expect(await card('Treino').findByText('Lendo o PDF…')).toBeInTheDocument()
    expect(card('Treino').getByLabelText('Enviar novo PDF')).toBeDisabled()
    expect(card('Protocolo').getByLabelText('Enviar novo PDF')).toBeDisabled()

    finish()
    expect(await screen.findByText('TELA DE REVISÃO')).toBeInTheDocument()
    const drafts = calls.filter((c) => c.path === '/api/plans/drafts')
    expect(drafts).toHaveLength(1)
    const body = JSON.parse(drafts[0]!.body)
    expect(body).toMatchObject({ fileId: FILE_ID, kind: 'workout', newExercises: [] })
    expect(body.document.days[0].exercises[0]).toMatchObject({ name: 'Movimento alfa', restSeconds: 120 })
    // Read on the device: the AI import is never called.
    expect(calls.some((c) => c.path === '/api/plans/import')).toBe(false)
    expect(vi.mocked(pdfText.extractPdfLines)).toHaveBeenCalledTimes(1)
  })

  it('a PDF without selectable text still opens an empty draft with the notice', async () => {
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue([])
    const calls = mockFetch(routes(() => json({ planVersionId: PLAN_ID }, 201)))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Protocolo' })

    await user.upload(card('Protocolo').getByLabelText('Enviar novo PDF'), pdf())

    expect(await screen.findByText('TELA DE REVISÃO · Esse PDF não tem texto selecionável. Preencha à mão.')).toBeInTheDocument()
    const body = JSON.parse(calls.find((c) => c.path === '/api/plans/drafts')!.body)
    expect(body).toMatchObject({ kind: 'protocol', document: { meals: [], items: [], guidelines: [] }, lowConfidence: [] })
  })

  it('an import that ends after the user went elsewhere does not take them to the review', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => (finish = resolve))
    const calls = mockFetch(routes(async () => (await gate, json({ planVersionId: PLAN_ID }, 201))))
    const user = userEvent.setup()
    await renderPage()
    await screen.findByRole('heading', { name: 'Treino' })
    await user.upload(card('Treino').getByLabelText('Enviar novo PDF'), pdf())
    await card('Treino').findByText('Lendo o PDF…')

    await user.click(screen.getByRole('link', { name: 'Ir para outra tela' }))
    finish()
    await waitFor(() => expect(calls.some((c) => c.path === '/api/plans/drafts')).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByText('OUTRA TELA')).toBeInTheDocument()
    expect(screen.queryByText('TELA DE REVISÃO')).not.toBeInTheDocument()
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

  it('"Editar datas" on the protocol card prefilled saves both dates through the API', async () => {
    const calls = mockFetch({
      [`PATCH /api/plans/${ACTIVE_ID}/cycle-dates`]: () => json({ id: ACTIVE_ID }),
      'POST /api/sync/push': () => json({ results: [] }),
      'GET /api/sync/pull': () => json({ records: [], nextSince: 0, hasMore: false }),
    })
    const user = userEvent.setup()
    await renderPage()

    await user.click(await within(await screen.findByRole('region', { name: 'Protocolo' })).findByRole('button', { name: 'Editar datas' }))
    expect(card('Treino').queryByRole('button', { name: 'Editar datas' })).not.toBeInTheDocument()
    const update = screen.getByLabelText('Próxima atualização')
    expect(update).toHaveValue('2026-11-20')
    await user.clear(update)
    await user.type(update, '2026-12-04')
    await user.type(screen.getByLabelText('Mensalidade'), '2026-12-10')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByLabelText('Próxima atualização')).not.toBeInTheDocument())
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(JSON.parse(patch.body)).toEqual({ updateDate: '2026-12-04', billingDate: '2026-12-10' })
  })
})
