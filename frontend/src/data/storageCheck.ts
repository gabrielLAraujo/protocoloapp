import { api } from '../api/client'

export type StorageCheckStep = 'upload-url' | 'upload' | 'confirm' | 'download-url' | 'download' | 'content'

/** The smoke test of the file storage failed at `step`. */
export class StorageCheckError extends Error {
  readonly step: StorageCheckStep

  constructor(step: StorageCheckStep) {
    super(`storage check failed at ${step}`)
    this.step = step
  }
}

/**
 * Sends a small text file to the bucket through a presigned URL, confirms it, downloads it through a presigned URL and compares.
 * It exercises exactly what the app does with real files: the signing, the bucket's CORS rule and the read permission.
 * @throws StorageCheckError naming the step that failed.
 */
export async function runStorageCheck(): Promise<void> {
  const text = `protocolo storage check ${new Date().toISOString()}`
  const bytes = new TextEncoder().encode(text)

  const upload = await attempt('upload-url', () =>
    api.POST('/api/files/upload-url', { body: { kind: 'test', contentType: 'text/plain', sizeBytes: bytes.length } }),
  )
  if (!upload.data) throw new StorageCheckError('upload-url')

  // Straight to the bucket: no Bearer token (the URL is the authorization), and the Content-Type that was signed.
  const put = await attempt('upload', () =>
    globalThis.fetch(upload.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes }),
  )
  if (!put.ok) throw new StorageCheckError('upload')

  const confirm = await attempt('confirm', () =>
    api.POST('/api/files/{id}/confirm', { params: { path: { id: upload.data.fileId } } }),
  )
  if (!confirm.response.ok) throw new StorageCheckError('confirm')

  const link = await attempt('download-url', () =>
    api.GET('/api/files/{id}/download-url', { params: { path: { id: upload.data.fileId } } }),
  )
  if (!link.data) throw new StorageCheckError('download-url')

  const download = await attempt('download', () => globalThis.fetch(link.data.url))
  if (!download.ok) throw new StorageCheckError('download')
  if ((await download.text()) !== text) throw new StorageCheckError('content')
}

async function attempt<T>(step: StorageCheckStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch {
    throw new StorageCheckError(step)
  }
}
