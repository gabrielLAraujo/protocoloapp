import { zipSync } from 'fflate'
import type { ApiClient } from '../../../data/apiClient'
import type { UpdateCycleLocal } from '../../../data/updateCycleRepo'

export const DOWNLOAD_FAILED_MESSAGE = 'Não foi possível baixar as fotos. Tente novamente.'

/** Thrown with a message ready for the screen (never anything of the photos). */
export class PhotosDownloadError extends Error {
  override name = 'PhotosDownloadError'
}

/** `01-front.jpg`, `02-back.jpg`… */
export const photoEntryName = (index: number, pose: string) => `${String(index + 1).padStart(2, '0')}-${pose}.jpg`

/** A zip of the photos, stored without compression (JPEG is compressed already). */
export function buildPhotosZip(entries: { name: string; bytes: Uint8Array }[]): Blob {
  const files: Record<string, Uint8Array> = {}
  for (const e of entries) files[e.name] = e.bytes
  const zipped = zipSync(files, { level: 0 })
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}

/**
 * Downloads every photo of the cycle through its signed URL and zips them, in the order of `poses` (the template's)
 * when given, otherwise in the cycle's order. Rejects with a PhotosDownloadError.
 */
export async function downloadCyclePhotos(cycle: UpdateCycleLocal, api: ApiClient, poses?: readonly { key: string }[]): Promise<Blob> {
  const rank = (pose: string) => {
    const i = poses?.findIndex((p) => p.key === pose) ?? -1
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const ordered = cycle.photos.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.pose) - rank(b.p.pose) || a.i - b.i)

  try {
    const entries: { name: string; bytes: Uint8Array }[] = []
    for (const [index, { p }] of ordered.entries()) {
      const signed = await api.GET('/api/files/{id}/download-url', { params: { path: { id: p.fileId } } })
      if (!signed.data) throw new PhotosDownloadError(DOWNLOAD_FAILED_MESSAGE)
      const file = await fetch(signed.data.url)
      if (!file.ok) throw new PhotosDownloadError(DOWNLOAD_FAILED_MESSAGE)
      entries.push({ name: photoEntryName(index, p.pose), bytes: new Uint8Array(await file.arrayBuffer()) })
    }
    return buildPhotosZip(entries)
  } catch (error) {
    throw error instanceof PhotosDownloadError ? error : new PhotosDownloadError(DOWNLOAD_FAILED_MESSAGE)
  }
}
