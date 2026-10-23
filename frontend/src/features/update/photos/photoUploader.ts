import type { ApiClient } from '../../../data/apiClient'
import type { LocalDb } from '../../../data/localDb'
import { photoThumbRepo } from '../../../data/photoThumbRepo'
import { updateCycleRepo } from '../../../data/updateCycleRepo'
import { getLocks, type Locks } from '../../../platform/locks'
import { thumbnail } from './imageTools'
import type { PendingPhoto, PhotoQueue } from './photoQueue'

export const PHOTO_UPLOAD_LOCK = 'protocolo-photo-upload'

export interface PhotoSyncDeps {
  db: LocalDb
  api: ApiClient
  queue: PhotoQueue
  now(): Date
  /** Defaults to navigator.locks (none: only the in-memory guard). */
  locks?: Locks
  /** Defaults to `thumbnail` (a canvas); the tests have none. */
  makeThumbnail?: (blob: Blob) => Promise<string>
}

export interface UploadResult {
  sent: number
  failed: number
}

/** The server refused the photo itself: sending it again cannot work. */
const REFUSED = new Set([400, 409, 413, 415, 422])

type Outcome = 'sent' | 'refused' | 'stop'

async function sendOne(deps: PhotoSyncDeps, photo: PendingPhoto): Promise<Outcome> {
  const contentType = photo.blob.type || 'image/jpeg'
  const slot = await deps.api.POST('/api/files/upload-url', { body: { kind: 'photo', contentType, sizeBytes: photo.blob.size } })
  if (!slot.data) return REFUSED.has(slot.response.status) ? 'refused' : 'stop'

  // Straight to the storage: no Authorization header, the URL is signed for this content type. A failure here is the
  // storage or an expired URL: a later run asks for a new one.
  const put = await fetch(slot.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: photo.blob })
  if (!put.ok) return 'stop'

  const confirm = await deps.api.POST('/api/files/{id}/confirm', { params: { path: { id: slot.data.fileId } } })
  if (!confirm.response.ok) return REFUSED.has(confirm.response.status) ? 'refused' : 'stop'

  const fileId = slot.data.fileId
  try {
    await updateCycleRepo.setPhoto(deps.db, photo.cycleId, { pose: photo.pose, fileId, takenAt: photo.takenAt }, deps.now())
  } catch (error) {
    // The cycle is gone (or the pose is invalid): the photo has nowhere to go.
    if (error instanceof RangeError) return 'refused'
    throw error
  }
  try {
    const dataUrl = await (deps.makeThumbnail ?? thumbnail)(photo.blob)
    await photoThumbRepo.put(deps.db, { fileId, cycleId: photo.cycleId, pose: photo.pose, dataUrl })
  } catch {
    // The photo is stored already; the screen shows a placeholder without the thumbnail.
  }
  return 'sent'
}

async function drain(deps: PhotoSyncDeps): Promise<UploadResult> {
  const result: UploadResult = { sent: 0, failed: 0 }
  const tried = new Set<string>()
  // Lists again after each pass: photos queued meanwhile (in any tab) go in the same run.
  for (;;) {
    const next = (await deps.queue.list()).filter((p) => !tried.has(p.id))
    if (next.length === 0) return result
    for (const photo of next) {
      tried.add(photo.id)
      let outcome: Outcome
      try {
        outcome = await sendOne(deps, photo)
      } catch {
        // A rejected fetch: no connection. Everything stays queued for the next run.
        return result
      }
      if (outcome === 'stop') return result
      await deps.queue.remove(photo.id)
      if (outcome === 'sent') result.sent++
      else result.failed++
    }
  }
}

let running: Promise<UploadResult> | null = null

/**
 * Sends the queued photos, one by one: upload-url, PUT, confirm, then the cycle's photo and the thumbnail, and only then
 * leaves the queue. No connection or a server error stops and keeps the rest; a photo the server refuses is dropped and
 * counted as failed. A call while a run is in flight shares it, and across tabs only the one holding the lock sends.
 */
export function uploadPending(deps: PhotoSyncDeps): Promise<UploadResult> {
  running ??= (async () => {
    const locks = deps.locks ?? getLocks()
    if (!locks) return drain(deps)
    const skipped: UploadResult = { sent: 0, failed: 0 }
    return (await locks.request(PHOTO_UPLOAD_LOCK, { ifAvailable: true }, (lock) => (lock ? drain(deps) : skipped))) as UploadResult
  })().finally(() => {
    running = null
  })
  return running
}

export interface PhotoSync {
  /** Queues a photo and starts sending. */
  enqueue(photo: PendingPhoto): Promise<void>
  /** Sends what is queued now. */
  flush(): Promise<UploadResult>
  stop(): void
}

/** Sends the queue now, whenever the connection comes back and after each new photo. Failures never reach the console. */
export function startPhotoSync(deps: PhotoSyncDeps): PhotoSync {
  const flush = () => uploadPending(deps).catch((): UploadResult => ({ sent: 0, failed: 0 }))
  const onOnline = () => void flush()
  window.addEventListener('online', onOnline)
  void flush()
  return {
    async enqueue(photo) {
      await deps.queue.add(photo)
      void flush()
    },
    flush,
    stop: () => window.removeEventListener('online', onOnline),
  }
}
