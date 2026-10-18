import { describe, expect, it } from 'vitest'
import { json, mockFetch, problem } from '../test/fetch-mock'
import { runStorageCheck, StorageCheckError } from './storageCheck'

const FILE_ID = '8b2f6c1e-3d4a-4e5f-9a6b-7c8d9e0f1a2b'

const routes = (overrides: Record<string, (call: { body: string; headers: Headers }) => Response> = {}) => {
  let stored = ''
  return {
    'POST /api/files/upload-url': () =>
      json({ fileId: FILE_ID, uploadUrl: 'https://bucket.example.test/put/obj', expiresAt: '2026-10-18T12:10:00+00:00' }),
    'PUT /put/obj': (call: { body: string }) => {
      stored = call.body
      return new Response(null, { status: 200 })
    },
    [`POST /api/files/${FILE_ID}/confirm`]: () => new Response(null, { status: 204 }),
    [`GET /api/files/${FILE_ID}/download-url`]: () =>
      json({ url: 'https://bucket.example.test/get/obj', expiresAt: '2026-10-18T12:05:00+00:00' }),
    'GET /get/obj': () => new Response(stored, { status: 200 }),
    ...overrides,
  }
}

describe('runStorageCheck', () => {
  it('uploads, confirms, downloads and compares a test file', async () => {
    const calls = mockFetch(routes())

    await runStorageCheck()

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/files/upload-url',
      'PUT /put/obj',
      `POST /api/files/${FILE_ID}/confirm`,
      `GET /api/files/${FILE_ID}/download-url`,
      'GET /get/obj',
    ])
    const request = JSON.parse(calls[0]!.body) as { kind: string; contentType: string; sizeBytes: number }
    expect(request).toMatchObject({ kind: 'test', contentType: 'text/plain' })
    expect(request.sizeBytes).toBe(new TextEncoder().encode(calls[1]!.body).length)
    expect(calls[1]!.headers.get('Content-Type')).toBe('text/plain')
    expect(calls[1]!.headers.get('Authorization')).toBeNull()
  })

  it('names the step that failed', async () => {
    mockFetch(routes({ 'PUT /put/obj': () => new Response(null, { status: 403 }) }))

    await expect(runStorageCheck()).rejects.toMatchObject({ step: 'upload' })
  })

  it('reports a network failure on the upload (typically the bucket CORS rule) as the upload step', async () => {
    mockFetch(
      routes({
        'PUT /put/obj': () => {
          throw new TypeError('Failed to fetch')
        },
      }),
    )

    await expect(runStorageCheck()).rejects.toBeInstanceOf(StorageCheckError)
    await expect(runStorageCheck()).rejects.toMatchObject({ step: 'upload' })
  })

  it('fails on the confirm step when the server refuses', async () => {
    mockFetch(routes({ [`POST /api/files/${FILE_ID}/confirm`]: () => problem(409) }))

    await expect(runStorageCheck()).rejects.toMatchObject({ step: 'confirm' })
  })

  it('fails when the downloaded content is not what was uploaded', async () => {
    mockFetch(routes({ 'GET /get/obj': () => new Response('something else', { status: 200 }) }))

    await expect(runStorageCheck()).rejects.toMatchObject({ step: 'content' })
  })
})
