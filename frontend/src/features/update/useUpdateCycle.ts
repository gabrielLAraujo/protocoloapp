import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useData } from '../../data/dataContext'
import type { LocalDb } from '../../data/localDb'
import { updateCycleRepo, type UpdateCycleLocal } from '../../data/updateCycleRepo'
import { useSync } from '../sync/syncContext'
import { ensureUpdateCycle } from './ensureCycle'
import { photoQueue } from './photos/photoQueue'
import { startPhotoSync, type PhotoSync } from './photos/photoUploader'

export { resetEnsureForTests } from './ensureCycle'

export type CycleState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; cycle: UpdateCycleLocal | null }

/**
 * The current update cycle (updateCycleRepo.current). With none locally and a connection, asks the server to create
 * the one of the active protocol (ensureUpdateCycle: once per user and session, retried after a failure) and syncs.
 * `reload` re-reads it; a pull (dataVersion) re-reads it too.
 */
export function useUpdateCycle(): { state: CycleState; reload(): void } {
  const data = useData()
  const { dataVersion, online, syncNow } = useSync()
  const [state, setState] = useState<CycleState>({ status: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    const run = async () => {
      let cycle = await updateCycleRepo.current(data.db)
      if (!cycle && online && (await ensureUpdateCycle(api, data.userId))) {
        await syncNow()
        cycle = await updateCycleRepo.current(data.db)
      }
      if (!cancelled) setState({ status: 'ok', cycle })
    }
    run().catch((error: unknown) => {
      console.error('could not read the update cycle', error instanceof Error ? error.name : 'unknown')
      if (!cancelled) setState({ status: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [data, dataVersion, online, syncNow, tick])

  return { state, reload: () => setTick((n) => n + 1) }
}

/**
 * Once the first sync after login ends well, asks the server for the cycle of the active protocol (a protocol activated
 * before the cycles existed has none, and the Hoje card and the reminder need it) and syncs again when one came back.
 */
export function useEnsureUpdateCycleAfterSync(): void {
  const data = useData()
  useEffect(() => {
    if (!data) return
    const { engine, userId } = data
    let sawRun = false
    let asked = false
    return engine.subscribe((status) => {
      if (status.running) {
        sawRun = true
        return
      }
      if (!sawRun || asked || status.lastError !== null) return
      asked = true
      void ensureUpdateCycle(api, userId).then((created) => {
        if (created) return engine.runOnce({ ignoreBackoff: true })
        // Not answered (offline, server error): the next good sync asks again.
        asked = false
        sawRun = false
      }).catch(() => undefined)
    })
  }, [data])
}

let running: { db: LocalDb; userId: string; sync: PhotoSync } | null = null

/** The app's photo queue sender, one per local database and user: started on first use, then on every `online` event. */
export function photoSyncFor(db: LocalDb, userId: string): PhotoSync {
  if (running?.db !== db || running.userId !== userId) {
    running?.sync.stop()
    running = { db, userId, sync: startPhotoSync({ db, api, userId, queue: photoQueue, now: () => new Date() }) }
  }
  return running.sync
}

/** Stops the sender (logout): the next user starts their own. */
export function stopPhotoSync(): void {
  running?.sync.stop()
  running = null
}

/** Starts sending the queued photos as soon as the user's data is open (AppShell), so they go up after a reload too. */
export function useStartPhotoSync(): void {
  const data = useData()
  useEffect(() => {
    if (!data) return
    photoSyncFor(data.db, data.userId)
    // Signed out (or another user): this sender stops; the next one starts with the next user.
    return () => stopPhotoSync()
  }, [data])
}
