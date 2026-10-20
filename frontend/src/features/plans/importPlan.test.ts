import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { FILE_ID, PLAN_ID } from './fixtures'
import type { DictionaryEntry } from '../../domain/exerciseDictionary'
import type { WorkoutDocument } from '../../domain/planDocuments'
import { applyExerciseMatches, createDeviceDraft, NO_TEXT_MESSAGE, readOnDevice, UNREADABLE_MESSAGE, type DeviceReading } from './importPlan'
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

// A tiny invented dictionary: "puxada" ties between two entries (low), "xyzzy" matches nothing (none).
const entry = (key: string, name: string, extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  key, name, aliases: [], group: 'back', equipment: 'other', catalogId: `cat-${key}`, catalogName: name, ...extra,
})
const DICTIONARY: DictionaryEntry[] = [
  entry('remada-baixa', 'Remada baixa', { group: 'back', aliases: ['remada sentada'] }),
  entry('crucifixo', 'Crucifixo máquina', { group: 'chest', catalogId: null, catalogName: null }),
  entry('puxada-polia', 'Puxada polia', { equipment: 'cable' }),
  entry('puxada-articulada', 'Puxada articulada', { equipment: 'machine' }),
]

const sheetOf = (...names: string[]): DeviceReading => ({
  document: { days: [{ key: 'A', name: 'Treino A', exercises: names.map((name, i) => ({ key: `e${i}`, name, sets: [{ repsMin: 8, repsMax: 10 }] })) }] } as WorkoutDocument,
  lowConfidence: ['days[0].name'],
  notice: null,
})
const exercisesOf = (reading: DeviceReading) => (reading.document as WorkoutDocument).days[0]!.exercises

describe('applyExerciseMatches', () => {
  const mine = [{ id: 'ex-1', name: 'Meu remo', aliases: ['Remada Curva Minha'] }]

  it('an exercise the user has gets its id and is not suggested as new', () => {
    const out = applyExerciseMatches(sheetOf('remada curva minha'), mine, DICTIONARY)
    expect(exercisesOf(out)[0]!.exerciseId).toBe('ex-1')
    expect(out.newExercises).toEqual([])
    expect(out.lowConfidence).toEqual(['days[0].name'])
  })

  it('a dictionary hit stays unlinked and becomes a new exercise with the entry group and catalog item', () => {
    const out = applyExerciseMatches(sheetOf('Remada Sentada', 'Crucifixo máquina'), [], DICTIONARY)
    expect(exercisesOf(out).map((e) => e.exerciseId)).toEqual([undefined, undefined])
    expect(out.newExercises).toEqual([
      { name: 'Remada Sentada', group: 'back', catalogId: 'cat-remada-baixa' },
      { name: 'Crucifixo máquina', group: 'chest', catalogId: null },
    ])
    expect(out.lowConfidence).toEqual(['days[0].name'])
  })

  it('a low-confidence match still suggests the group and catalog item, and marks the exercise name', () => {
    const out = applyExerciseMatches(sheetOf('Remada baixa', 'Puxada'), [], DICTIONARY)
    expect(out.lowConfidence).toEqual(['days[0].name', 'days[0].exercises[1].name'])
    expect(out.newExercises).toHaveLength(2)
    expect(out.newExercises![1]).toMatchObject({ name: 'Puxada', group: 'back' })
    expect(out.newExercises![1]!.catalogId).toMatch(/^cat-puxada-/)
  })

  it('no match marks the exercise name and suggests nothing (the review asks for the group)', () => {
    const out = applyExerciseMatches(sheetOf('xyzzy'), [], DICTIONARY)
    expect(out.lowConfidence).toEqual(['days[0].name', 'days[0].exercises[0].name'])
    expect(out.newExercises).toEqual([])
  })

  it('a user exercise that the dictionary also knows, and has no media yet, carries the catalog link; one with media does not', () => {
    const users = [
      { id: 'ex-1', name: 'Remada baixa', aliases: [], catalogId: null },
      { id: 'ex-2', name: 'Remada sentada', aliases: [], catalogId: 'cat-already' },
    ]
    const first = exercisesOf(applyExerciseMatches(sheetOf('Remada baixa'), users, DICTIONARY))[0]!
    expect(first).toMatchObject({ exerciseId: 'ex-1', catalogId: 'cat-remada-baixa' })
    expect(first.aliasConfirmed).toBeUndefined()
    const second = exercisesOf(applyExerciseMatches(sheetOf('Remada sentada'), [users[1]!], DICTIONARY))[0]!
    expect(second.exerciseId).toBe('ex-2')
    expect(second.catalogId).toBeUndefined()
  })

  it('a dictionary hit that the user already has under another name links that exercise (low confidence) instead of duplicating it', () => {
    // Same catalog item as the entry.
    const byCatalog = applyExerciseMatches(sheetOf('Remada sentada'), [{ id: 'ex-3', name: 'Meu remo especial', aliases: [], catalogId: 'cat-remada-baixa' }], DICTIONARY)
    expect(exercisesOf(byCatalog)[0]).toMatchObject({ exerciseId: 'ex-3' })
    expect(exercisesOf(byCatalog)[0]!.catalogId).toBeUndefined()
    expect(byCatalog.newExercises).toEqual([])
    expect(byCatalog.lowConfidence).toContain('days[0].exercises[0].name')

    // The user's name resolves to the same dictionary entry; it has no media, so the link is sent.
    const byName = applyExerciseMatches(sheetOf('Remada sentada'), [{ id: 'ex-4', name: 'Remada baixa', aliases: [], catalogId: null }], DICTIONARY)
    expect(exercisesOf(byName)[0]).toMatchObject({ exerciseId: 'ex-4', catalogId: 'cat-remada-baixa' })
    expect(byName.newExercises).toEqual([])
    expect(byName.lowConfidence).toContain('days[0].exercises[0].name')
  })

  it('suggests a repeated name once and leaves exercises that already have an id alone', () => {
    const reading = sheetOf('Remada baixa', 'remada  BAIXA', 'Crucifixo máquina')
    ;(reading.document as WorkoutDocument).days[0]!.exercises[2]!.exerciseId = '7d1f2a10-0000-5000-8000-0000000000e1'
    const out = applyExerciseMatches(reading, [], DICTIONARY)
    expect(out.newExercises).toEqual([{ name: 'Remada baixa', group: 'back', catalogId: 'cat-remada-baixa' }])
  })

  it('does not change a protocol reading', () => {
    const reading: DeviceReading = { document: { meals: [], items: [], guidelines: [] }, lowConfidence: [], notice: null }
    expect(applyExerciseMatches(reading, mine, DICTIONARY)).toBe(reading)
  })
})

describe('readOnDevice matching', () => {
  it('matches the sheet against the user exercises and the built-in dictionary', async () => {
    vi.mocked(pdfText.extractPdfLines).mockResolvedValue(lines('(grupo um) 3x 8 a 12', '- Agachamento livre', '- Meu movimento alfa', 'DESCANSO'))
    const reading = await readOnDevice('workout', BYTES, '2026-10-19', [{ id: 'ex-9', name: 'Meu movimento alfa', aliases: [] }])
    const [first, second] = exercisesOf(reading)
    expect(second!.exerciseId).toBe('ex-9')
    expect(first!.exerciseId ?? null).toBeNull()
    expect(reading.newExercises).toHaveLength(1)
    expect(reading.newExercises![0]).toMatchObject({ name: 'Agachamento livre' })
    expect(reading.newExercises![0]!.group).toBe('quads')
  })
})

describe('createDeviceDraft', () => {
  const reading = (): DeviceReading => ({ document: { days: [] }, lowConfidence: ['days[0].name'], notice: null })

  it('posts the document, low-confidence paths and no new exercises, and gives the draft id', async () => {
    const calls = mockFetch({ 'POST /api/plans/drafts': () => json({ planVersionId: PLAN_ID }, 201) })
    expect(await createDeviceDraft('workout', FILE_ID, reading())).toEqual({ id: PLAN_ID, notice: null })
    expect(JSON.parse(calls[0]!.body)).toEqual({ fileId: FILE_ID, kind: 'workout', document: { days: [] }, lowConfidence: ['days[0].name'], newExercises: [] })
  })

  it('sends the suggested new exercises with their catalog item', async () => {
    const calls = mockFetch({ 'POST /api/plans/drafts': () => json({ planVersionId: PLAN_ID }, 201) })
    const read: DeviceReading = { document: { days: [] }, lowConfidence: [], notice: null, newExercises: [{ name: 'Remada', group: 'back', catalogId: 'cat-1' }] }
    await createDeviceDraft('workout', FILE_ID, read)
    expect(JSON.parse(calls[0]!.body).newExercises).toEqual([{ name: 'Remada', group: 'back', catalogId: 'cat-1' }])
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
