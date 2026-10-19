import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { FILE_ID, PLAN_ID } from './fixtures'
import { createDeviceDraft, NO_TEXT_MESSAGE, readOnDevice, UNREADABLE_MESSAGE, type DeviceReading } from './importPlan'
import type { PdfLine } from './pdf/pdfText'
import * as pdfText from './pdf/pdfText'
import * as workoutParser from './pdf/workoutParser'
import { ImportError } from './uploadPdf'

vi.mock('./pdf/pdfText', () => ({ extractPdfLines: vi.fn() }))
vi.mock('./pdf/workoutParser', async (original) => {
  const real = await original<typeof import('./pdf/workoutParser')>()
  return { ...real, parseWorkout: vi.fn(real.parseWorkout) }
})

// Invented sheet lines, same shape as the parsers' own tests.
const lines = (...texts: string[]): PdfLine[] => texts.map((text, i) => ({ page: 1, y: 800 - i * 14, items: [{ x: 72, text }], text }))
const workoutLines = () => lines('(grupo um) 3x 8 a 12', '- Movimento alfa (2x9 a 11) (intervalo 2 min)', 'DESCANSO')
const BYTES = new ArrayBuffer(8)

afterEach(() => vi.clearAllMocks())

describe('readOnDevice', () => {
  it('reads a workout sheet into a document with its low-confidence paths', async () => {
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue(
      lines('(grupo um) 3x 8 a 12', '- Movimento alfa', '- Movimento beta (2x9 a 11) (intervalo 2 min)', 'DESCANSO'),
    )
    const reading = await readOnDevice('workout', BYTES, '2026-10-19')
    expect(reading.notice).toBeNull()
    expect(reading.document).toMatchObject({ days: [{ key: 'A', exercises: [{ name: 'Movimento alfa' }, { name: 'Movimento beta' }] }] })
    expect(reading.lowConfidence).toContain('days[0].exercises[0].sets')
  })

  it('a PDF without selectable text gives an empty document and the "no text" notice', async () => {
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue(lines('12', 'p. 1'))
    expect(await readOnDevice('protocol', BYTES, '2026-10-19')).toEqual({
      document: { meals: [], items: [], guidelines: [] },
      lowConfidence: [],
      notice: NO_TEXT_MESSAGE,
    })
  })

  it('a PDF pdf.js cannot open gives the "could not read" notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(pdfText.extractPdfLines).mockRejectedValue(new Error('Invalid PDF structure'))
    expect(await readOnDevice('workout', BYTES, '2026-10-19')).toEqual({ document: { days: [] }, lowConfidence: [], notice: UNREADABLE_MESSAGE })
  })

  it('a parser that throws gives the "could not read" notice and logs no PDF text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue(workoutLines())
    vi.mocked(workoutParser.parseWorkout).mockImplementationOnce(() => {
      throw new TypeError('Movimento alfa')
    })
    const reading = await readOnDevice('workout', BYTES, '2026-10-19')
    expect(reading).toEqual({ document: { days: [] }, lowConfidence: [], notice: UNREADABLE_MESSAGE })
    expect(JSON.stringify(log.mock.calls)).not.toContain('Movimento alfa')
  })

  it('text in another layout (no day recognized) gives the "could not read" notice', async () => {
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue(lines('Um texto qualquer sem nenhum bloco de treino', 'Outra linha qualquer'))
    expect((await readOnDevice('workout', BYTES, '2026-10-19')).notice).toBe(UNREADABLE_MESSAGE)
  })
})

describe('createDeviceDraft', () => {
  const reading = (): DeviceReading => ({ document: { days: [] }, lowConfidence: ['days[0].name'], notice: null })

  it('posts the document, low-confidence paths and no new exercises, and gives the draft id', async () => {
    const calls = mockFetch({ 'POST /api/plans/drafts': () => json({ planVersionId: PLAN_ID }, 201) })
    expect(await createDeviceDraft('workout', FILE_ID, reading())).toEqual({ id: PLAN_ID, notice: null })
    expect(JSON.parse(calls[0]!.body)).toEqual({ fileId: FILE_ID, kind: 'workout', document: { days: [] }, lowConfidence: ['days[0].name'], newExercises: [] })
  })

  it('a document the server refuses becomes an empty draft with the "could not read" notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let first = true
    const calls = mockFetch({
      'POST /api/plans/drafts': () => {
        if (!first) return json({ planVersionId: PLAN_ID }, 201)
        first = false
        return problem(400, { errors: { 'days[0].sets': ['Valor inválido.'] } })
      },
    })
    const read: DeviceReading = { document: { days: [{ key: 'A', name: 'X', exercises: [] }] }, lowConfidence: ['days[0].name'], notice: null }
    expect(await createDeviceDraft('workout', FILE_ID, read)).toEqual({ id: PLAN_ID, notice: UNREADABLE_MESSAGE })
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ document: { days: [] }, lowConfidence: [] })
  })

  it('keeps the notice of an empty reading', async () => {
    mockFetch({ 'POST /api/plans/drafts': () => json({ planVersionId: PLAN_ID }, 201) })
    expect(await createDeviceDraft('protocol', FILE_ID, { document: { meals: [], items: [], guidelines: [] }, lowConfidence: [], notice: NO_TEXT_MESSAGE })).toEqual({
      id: PLAN_ID,
      notice: NO_TEXT_MESSAGE,
    })
  })

  it('fails with a screen message when the server or the connection fails', async () => {
    mockFetch({ 'POST /api/plans/drafts': () => problem(503, { title: 'x' }) })
    await expect(createDeviceDraft('workout', FILE_ID, reading())).rejects.toThrow(new ImportError('Importação indisponível no momento.'))
    mockFetch({})
    await expect(createDeviceDraft('workout', FILE_ID, reading())).rejects.toThrow(new ImportError('Conecte-se à internet para importar'))
  })
})
