import 'fake-indexeddb/auto'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))

import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { photoThumbRepo } from '../../data/photoThumbRepo'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { updateCycleRepo } from '../../data/updateCycleRepo'
import { FILL_METRICS } from '../../domain/fillMetrics'
import { questionnaireTemplateSchema, type QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { json, mockFetch, problem, type Handler } from '../../test/fetch-mock'
import { USER_A } from '../../test/localDb'
import { setupApp } from '../testSupport'
import { answersAsText } from './answers'
import { fillText } from './fillText'
import { metricsCache } from './metricsCache'
import { photoQueue } from './photos/photoQueue'
import { CYCLE_ID, PREVIOUS_CYCLE_ID, seedCycle } from './testCycle'
import { emptyMetrics, sampleMetrics } from './testMetrics'
import { NATIVE_ZIP_MESSAGE, UpdatePage } from './UpdatePage'
import { UNSUPPORTED_PHOTO_MESSAGE, uploadFailedMessage } from './photos/photoMessages'
import { resetEnsureForTests } from './useUpdateCycle'

const files = import.meta.glob<unknown>('../../../../fixtures/questionnaire-template.example.json', { eager: true, import: 'default' })
const fixture = (): QuestionnaireTemplate => questionnaireTemplateSchema.parse(structuredClone(Object.values(files)[0]))

const METRICS_ROUTE = `GET /api/update-cycles/${CYCLE_ID}/metrics`
const MISSED = 'Quantos treinos de exemplo foram perdidos?'
const MISSED_TEXT = fillText('missed_workouts', sampleMetrics())

const metricsOnline = (): Record<string, Handler> => ({ [METRICS_ROUTE]: () => json({ ...sampleMetrics(), cycleId: CYCLE_ID }) })

async function open({
  routes = metricsOnline(),
  template = true,
  seed = {} as Parameters<typeof seedCycle>[1] | null,
}: { routes?: Record<string, Handler>; template?: boolean; seed?: Parameters<typeof seedCycle>[1] | null } = {}) {
  const calls = mockFetch(routes)
  const app = await setupApp()
  vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  if (seed) await seedCycle(app.db, seed)
  if (template) await questionnaireTemplateRepo.save(app.db, fixture(), new Date('2026-10-01T12:00:00Z'))
  const view = app.view(<UpdatePage />)
  await screen.findByRole('heading', { name: 'Atualização' })
  return { ...app, ...view, calls }
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(name) })

beforeEach(() => {
  native.value = false
  resetEnsureForTests()
})

afterEach(async () => {
  for (const p of await photoQueue.list()) await photoQueue.remove(p.id)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fill texts', () => {
  it('every metric has a text, with data and on an empty cycle', () => {
    for (const metric of FILL_METRICS) {
      expect(fillText(metric, sampleMetrics()), metric).not.toBe('')
      expect(fillText(metric, emptyMetrics()), metric).not.toBe('')
    }
  })
})

describe('UpdatePage', () => {
  it('shows the period and the three steps, the poses first', async () => {
    await open()
    expect(screen.getByText('01/10 a 23/10')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/^\d\./, ''))).toEqual(['Fotos', 'Questionário', 'Revisar e enviar'])
    expect(tab('Fotos')).toHaveAttribute('aria-selected', 'true')
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    expect(within(front).getByText('Falta')).toBeInTheDocument()
    expect(within(front).getByRole('button', { name: 'Tirar foto' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('a sent pose shows its thumbnail', async () => {
    const fileId = '00000000-0000-0000-0000-0000000000f1'
    mockFetch({})
    const app = await setupApp()
    await seedCycle(app.db, { photos: [{ pose: 'front', file_id: fileId, taken_at: '2026-10-19T10:00:00Z' }] })
    await photoThumbRepo.put(app.db, { fileId, cycleId: CYCLE_ID, pose: 'front', dataUrl: 'data:image/jpeg;base64,AAAA' })
    app.view(<UpdatePage />)
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    expect(within(front).getByRole('img', { name: 'Miniatura de Frente' })).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA')
    expect(within(front).getByText('Enviada')).toBeInTheDocument()
    expect(within(front).getByRole('button', { name: 'Refazer' })).toBeInTheDocument()
  })

  it('a photo taken without a connection stays pending in the queue', async () => {
    const user = userEvent.setup()
    await open({ routes: { ...metricsOnline(), 'POST /api/files/upload-url': () => problem(503) } })
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    await user.click(within(front).getByRole('button', { name: 'Tirar foto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Frente' })
    // A generated image: a few bytes of a colored rectangle, never a real photo.
    const picked = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])], 'pose.jpg', { type: 'image/jpeg' })
    await user.upload(within(dialog).getByLabelText('Escolher foto'), picked)

    expect(await within(await screen.findByRole('listitem', { name: 'Frente' })).findByText('Pendente de envio')).toBeInTheDocument()
    expect((await photoQueue.list()).map((p) => [p.userId, p.cycleId, p.pose])).toEqual([[USER_A, CYCLE_ID, 'front']])
  })

  it('a format the device cannot convert (HEIC) is refused at capture with a message, and nothing is queued', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await open()
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    await user.click(within(front).getByRole('button', { name: 'Tirar foto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Frente' })
    // Generated bytes with a HEIC type: jsdom cannot decode it, like a browser without HEIC support.
    const picked = new File([new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74])], 'pose.heic', { type: 'image/heic' })
    await user.upload(within(dialog).getByLabelText('Escolher foto'), picked)

    expect(await screen.findByText(UNSUPPORTED_PHOTO_MESSAGE)).toBeInTheDocument()
    expect(await photoQueue.list()).toEqual([])
    expect(within(screen.getByRole('listitem', { name: 'Frente' })).getByText('Falta')).toBeInTheDocument()
  })

  it('a photo the server refuses says which pose to take again instead of vanishing', async () => {
    const user = userEvent.setup()
    await open({ routes: { ...metricsOnline(), 'POST /api/files/upload-url': () => problem(415) } })
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    await user.click(within(front).getByRole('button', { name: 'Tirar foto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Frente' })
    const picked = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])], 'pose.jpg', { type: 'image/jpeg' })
    await user.upload(within(dialog).getByLabelText('Escolher foto'), picked)

    expect(await screen.findByText(uploadFailedMessage('Frente'))).toBeInTheDocument()
    expect(uploadFailedMessage('Frente')).toBe('Não foi possível enviar a foto de Frente. Tente de novo.')
    expect(await photoQueue.list()).toEqual([])
  })

  it('a fill question comes calculated; an edit wins, survives a reload, and "Recalcular" brings the calculation back', async () => {
    const user = userEvent.setup()
    const app = await open()
    await user.click(tab('Questionário'))
    const field = await screen.findByRole('textbox', { name: MISSED })
    await waitFor(() => expect(field).toHaveValue(MISSED_TEXT))
    expect(screen.getAllByText('Calculado')).toHaveLength(4)

    await user.clear(field)
    await user.type(field, 'Nenhum de exemplo')
    expect(screen.getAllByText('Calculado')).toHaveLength(3)
    await waitFor(async () => expect((await updateCycleRepo.byId(app.db, CYCLE_ID))?.answers.missed_workouts).toBe('Nenhum de exemplo'), {
      timeout: 2000,
    })
    expect((await updateCycleRepo.byId(app.db, CYCLE_ID))?.status).toBe('draft')

    app.unmount()
    app.view(<UpdatePage />)
    await user.click(await screen.findByRole('tab', { name: /Questionário/ }))
    expect(await screen.findByRole('textbox', { name: MISSED })).toHaveValue('Nenhum de exemplo')
    await waitFor(() => expect(screen.getAllByText('Calculado')).toHaveLength(3))

    const block = screen.getByRole('textbox', { name: MISSED }).closest('div')!
    await user.click(within(block).getByRole('button', { name: 'Recalcular' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: MISSED })).toHaveValue(MISSED_TEXT))
    expect(screen.getAllByText('Calculado')).toHaveLength(4)
    expect(Object.hasOwn((await updateCycleRepo.byId(app.db, CYCLE_ID))!.answers, 'missed_workouts')).toBe(false)
  })

  it('offline uses the cached metrics and says when they were calculated', async () => {
    mockFetch({})
    const app = await setupApp()
    await seedCycle(app.db)
    await questionnaireTemplateRepo.save(app.db, fixture(), new Date('2026-10-01T12:00:00Z'))
    await metricsCache.put(app.db, CYCLE_ID, sampleMetrics(), new Date(2026, 9, 18, 9, 0))
    app.view(<UpdatePage />)
    await userEvent.click(await screen.findByRole('tab', { name: /Questionário/ }))
    expect(await screen.findByText('Sem conexão. Calculado em 18/10.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: MISSED })).toHaveValue(MISSED_TEXT)
  })

  it('without a template the questionnaire points to Configurações', async () => {
    await open({ template: false })
    await userEvent.click(tab('Questionário'))
    expect(screen.getByText('Nenhum questionário ainda')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Importe o modelo em Configurações' })).toHaveAttribute('href', '/configuracoes/questionario')
  })

  it('"Ver notas do ciclo" lists the evening notes of the period', async () => {
    const user = userEvent.setup()
    mockFetch(metricsOnline())
    const app = await setupApp()
    await seedCycle(app.db, { periodStart: '2026-10-01', periodEnd: '2026-10-05' })
    await questionnaireTemplateRepo.save(app.db, fixture(), new Date('2026-10-01T12:00:00Z'))
    const evening = (note: string | null) => ({ energyDay: 3, anxiety: 2, waterL: 3, note })
    await dailyCheckinRepo.saveEvening(app.db, USER_A, '2026-10-02', evening('Nota fictícia do dia dois'), new Date())
    await dailyCheckinRepo.saveEvening(app.db, USER_A, '2026-10-03', evening(null), new Date())
    await dailyCheckinRepo.saveEvening(app.db, USER_A, '2026-10-09', evening('Fora do período'), new Date())
    app.view(<UpdatePage />)
    await user.click(await screen.findByRole('tab', { name: /Questionário/ }))
    await user.click(screen.getAllByRole('button', { name: 'Ver notas do ciclo' })[0]!)

    const sheet = await screen.findByRole('dialog', { name: 'Notas do ciclo' })
    expect(await within(sheet).findByText('Nota fictícia do dia dois')).toBeInTheDocument()
    expect(within(sheet).getByText('02/10')).toBeInTheDocument()
    expect(within(sheet).queryByText('Fora do período')).not.toBeInTheDocument()
  })

  it('an empty cycle says so in the sheet', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(tab('Questionário'))
    await user.click(screen.getAllByRole('button', { name: 'Ver notas do ciclo' })[0]!)
    expect(await screen.findByText('Nenhuma nota no ciclo.')).toBeInTheDocument()
  })

  it('"Copiar texto" copies the answers in the template order; "Gerar PDF" prints', async () => {
    const user = userEvent.setup()
    await open({ seed: { answers: { diet_hunger: 'Normal' } } })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    await user.click(tab('Revisar e enviar'))
    await within(screen.getByRole('tabpanel')).findByText(MISSED_TEXT)
    const write = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(screen.getByRole('button', { name: 'Copiar texto' }))
    expect(write).toHaveBeenCalledWith(answersAsText(fixture(), { diet_hunger: 'Normal' }, { ...sampleMetrics(), cycleId: CYCLE_ID }))
    expect(await screen.findByText('Texto copiado')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Gerar PDF' }))
    expect(print).toHaveBeenCalledOnce()
  })

  it('"Marcar como enviada" stores the resolved answers and shows the date', async () => {
    const user = userEvent.setup()
    const app = await open({ seed: { answers: { diet_hunger: 'Normal' } } })
    await user.click(tab('Revisar e enviar'))
    await within(screen.getByRole('tabpanel')).findByText(MISSED_TEXT)
    await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }))

    await waitFor(async () => expect((await updateCycleRepo.byId(app.db, CYCLE_ID))?.status).toBe('sent'))
    const stored = (await updateCycleRepo.byId(app.db, CYCLE_ID))!
    expect(stored.answers).toMatchObject({ diet_hunger: 'Normal', missed_workouts: MISSED_TEXT })
    expect(stored.answers).not.toHaveProperty('workout_rating')
    expect(await screen.findByText(/^Enviada em \d\d\/\d\d$/)).toBeInTheDocument()
  })

  it('in the APK there is no "Gerar PDF", and without share the zip asks for the browser', async () => {
    native.value = true
    const user = userEvent.setup()
    await open({ seed: { photos: [{ pose: 'front', file_id: '00000000-0000-0000-0000-0000000000f1', taken_at: '2026-10-19T10:00:00Z' }] } })
    vi.stubGlobal('navigator', { ...navigator, share: undefined, canShare: undefined, onLine: true })
    await user.click(tab('Revisar e enviar'))
    await within(screen.getByRole('tabpanel')).findByText(MISSED_TEXT)
    expect(screen.queryByRole('button', { name: 'Gerar PDF' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar texto' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Baixar fotos (.zip)' }))
    expect(await screen.findByText(NATIVE_ZIP_MESSAGE)).toBeInTheDocument()
  })

  it('with no local cycle and a connection, asks the server for it', async () => {
    const calls = (await open({ seed: null, routes: { 'POST /api/update-cycles/ensure': () => new Response(null, { status: 204 }) } })).calls
    expect(await screen.findByText('Nenhuma atualização em andamento')).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/api/update-cycles/ensure')).toHaveLength(1)
  })

  it('the camera gets the same pose of the previous cycle', async () => {
    const user = userEvent.setup()
    mockFetch(metricsOnline())
    const app = await setupApp()
    const oldFile = '00000000-0000-0000-0000-0000000000e1'
    await seedCycle(app.db, {
      id: PREVIOUS_CYCLE_ID,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: 'sent',
      photos: [{ pose: 'front', file_id: oldFile, taken_at: '2026-09-29T10:00:00Z' }],
    })
    await photoThumbRepo.put(app.db, { fileId: oldFile, cycleId: PREVIOUS_CYCLE_ID, pose: 'front', dataUrl: 'data:image/jpeg;base64,BBBB' })
    await seedCycle(app.db)
    app.view(<UpdatePage />)
    const front = await screen.findByRole('listitem', { name: 'Frente' })
    await user.click(within(front).getByRole('button', { name: 'Tirar foto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Frente' })
    expect(within(dialog).getByRole('img', { name: 'Foto anterior de Frente' })).toHaveAttribute('src', 'data:image/jpeg;base64,BBBB')
  })
})
