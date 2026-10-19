import { describe, expect, it } from 'vitest'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { FILE_ID, PLAN_ID } from './fixtures'
import { ImportError, uploadPdf } from './uploadPdf'

const pdf = () => new File(['%PDF-1.4 fake'], 'ficha.pdf', { type: 'application/pdf' })
const STORAGE = 'http://storage.test/upload/abc'

const happyRoutes = () => ({
  'POST /api/files/upload-url': () => json({ fileId: FILE_ID, uploadUrl: STORAGE, expiresAt: '2026-10-18T12:00:00Z' }),
  'PUT /upload/abc': () => new Response(null, { status: 200 }),
  [`POST /api/files/${FILE_ID}/confirm`]: () => new Response(null, { status: 204 }),
  'POST /api/plans/import': () => json({ id: PLAN_ID }, 201),
})

describe('uploadPdf', () => {
  it('calls upload-url, PUT with the content type, confirm and import, in that order', async () => {
    const calls = mockFetch(happyRoutes())
    const stages: string[] = []

    const id = await uploadPdf('workout', pdf(), (s) => stages.push(s))

    expect(id).toBe(PLAN_ID)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/files/upload-url',
      'PUT /upload/abc',
      `POST /api/files/${FILE_ID}/confirm`,
      'POST /api/plans/import',
    ])
    expect(JSON.parse(calls[0]!.body)).toEqual({ kind: 'workoutPdf', contentType: 'application/pdf', sizeBytes: 13 })
    expect(calls[1]!.headers.get('content-type')).toBe('application/pdf')
    expect(calls[1]!.headers.get('authorization')).toBeNull()
    expect(JSON.parse(calls[3]!.body)).toEqual({ fileId: FILE_ID, kind: 'workout' })
    expect(stages).toEqual(['uploading', 'reading'])
  })

  it('a protocol is sent as protocolPdf', async () => {
    const calls = mockFetch(happyRoutes())
    await uploadPdf('protocol', pdf())
    expect(JSON.parse(calls[0]!.body).kind).toBe('protocolPdf')
  })

  it.each([
    [503, 'Importação indisponível no momento.'],
    [413, 'PDF grande demais (máx. 20 MB).'],
  ])('import answering %i says "%s"', async (status, message) => {
    mockFetch({ ...happyRoutes(), 'POST /api/plans/import': () => problem(status, { title: 'x' }) })
    await expect(uploadPdf('workout', pdf())).rejects.toThrow(new ImportError(message))
  })

  it('refuses a file over 20 MiB or that is not a PDF before asking for an upload url', async () => {
    const calls = mockFetch(happyRoutes())
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'ficha.pdf', { type: 'application/pdf' })
    await expect(uploadPdf('workout', big)).rejects.toThrow(new ImportError('PDF grande demais (máx. 20 MB).'))
    const image = new File(['x'], 'ficha.png', { type: 'image/png' })
    await expect(uploadPdf('workout', image)).rejects.toThrow(new ImportError('Envie um arquivo PDF.'))
    expect(calls).toHaveLength(0)
    // Exactly 20 MiB still goes through.
    const exact = new File([new Uint8Array(20 * 1024 * 1024)], 'ficha.pdf', { type: 'application/pdf' })
    await expect(uploadPdf('workout', exact)).resolves.toBe(PLAN_ID)
  })

  it('no connection says to connect to the internet', async () => {
    mockFetch({}) // every request fails like a dropped connection
    await expect(uploadPdf('workout', pdf())).rejects.toThrow('Conecte-se à internet para importar')
  })

  it('a failed PUT stops before confirming', async () => {
    const calls = mockFetch({ ...happyRoutes(), 'PUT /upload/abc': () => new Response(null, { status: 403 }) })
    await expect(uploadPdf('workout', pdf())).rejects.toBeInstanceOf(ImportError)
    expect(calls).toHaveLength(2)
  })
})
