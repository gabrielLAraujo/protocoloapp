/**
 * Photos waiting to be sent, in IndexedDB (they outlive a reload and a closed app). The bytes are stored as an
 * ArrayBuffer, not a Blob: some WebViews cannot keep Blobs in IndexedDB.
 */
export const PHOTO_QUEUE_DB = 'protocolo-photos'
const STORE = 'pending'

export interface PendingPhoto {
  id: string
  /** The signed-in user who took it: the sender drops a photo of another user (an account switch on the device). */
  userId: string
  cycleId: string
  pose: string
  blob: Blob
  /** ISO timestamp. */
  takenAt: string
}

type Stored = Omit<PendingPhoto, 'blob' | 'userId'> & { userId?: string; type: string; bytes: ArrayBuffer }

export interface PhotoQueue {
  /** Queues a photo; one still waiting for the same cycle and pose is dropped (only the latest goes up). */
  add(photo: PendingPhoto): Promise<void>
  /** The waiting photos, oldest first. */
  list(): Promise<PendingPhoto[]>
  remove(id: string): Promise<void>
  /** Drops every waiting photo (logout, or another account signing in). */
  clear(): Promise<void>
  /** Closes the connection (the next call opens it again). */
  close(): void
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

export function createPhotoQueue(factory: () => IDBFactory = () => indexedDB): PhotoQueue {
  let opening: Promise<IDBDatabase> | null = null

  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory().open(PHOTO_QUEUE_DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    }).catch((error: unknown) => {
      opening = null
      throw error
    })
    return opening
  }

  const readAll = async (): Promise<Stored[]> => {
    const db = await open()
    return done(db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<Stored[]>)
  }

  return {
    async add(photo) {
      // Read before the transaction: an await inside it would let it commit early.
      const bytes = await photo.blob.arrayBuffer()
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const all = await done(store.getAll() as IDBRequest<Stored[]>)
      for (const old of all) if (old.cycleId === photo.cycleId && old.pose === photo.pose && old.id !== photo.id) store.delete(old.id)
      const stored: Stored = { id: photo.id, userId: photo.userId, cycleId: photo.cycleId, pose: photo.pose, takenAt: photo.takenAt, type: photo.blob.type || 'image/jpeg', bytes }
      store.put(stored)
      await committed(tx)
    },

    async list() {
      const all = await readAll()
      return all
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id))
        // A photo queued before the owner was stored has none (''): never anyone's, so the sender drops it.
        .map(({ type, bytes, ...rest }) => ({ ...rest, userId: rest.userId ?? '', blob: new Blob([bytes], { type }) }))
    },

    async remove(id) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      await committed(tx)
    },

    async clear() {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      await committed(tx)
    },

    close() {
      const current = opening
      opening = null
      void current?.then((db) => db.close(), () => undefined)
    },
  }
}

/** The app's queue (the browser's IndexedDB). */
export const photoQueue: PhotoQueue = createPhotoQueue()
