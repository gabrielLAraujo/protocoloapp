import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useData } from '../../data/dataContext'
import type { LocalDb } from '../../data/localDb'
import { updateCycleRepo, type UpdateCycleLocal } from '../../data/updateCycleRepo'
import { useSync } from '../sync/syncContext'
import { photoQueue } from './photos/photoQueue'
import { startPhotoSync, type PhotoSync } from './photos/photoUploader'

export type CycleState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; cycle: UpdateCycleLocal | null }

/** Asked once per session: a protocol activated before cycles existed gets its cycle on the first visit. */
let ensured = false

/** For the tests. */
export function resetEnsureForTests() {
  ensured = false
}

/**
 * The current update cycle (the live one with the latest period). With none locally and a connection, asks the
 * server to create the one of the active protocol (`POST /api/update-cycles/ensure`, once per session) and syncs.
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
      if (!cycle && online && !ensured) {
        ensured = true
        try {
          const { data: created } = await api.POST('/api/update-cycles/ensure')
          if (created) {
            await syncNow()
            cycle = await updateCycleRepo.current(data.db)
          }
        } catch {
          // Offline after all: the next session asks again.
          ensured = false
        }
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

let running: { db: LocalDb; sync: PhotoSync } | null = null

/** The app's photo queue sender, one per local database: started on first use, then on every `online` event. */
export function photoSyncFor(db: LocalDb): PhotoSync {
  if (running?.db !== db) {
    running?.sync.stop()
    running = { db, sync: startPhotoSync({ db, api, queue: photoQueue, now: () => new Date() }) }
  }
  return running.sync
}

/** Starts sending the queued photos as soon as the user's data is open (AppShell), so they go up after a reload too. */
export function useStartPhotoSync(): void {
  const data = useData()
  useEffect(() => {
    if (data) photoSyncFor(data.db)
  }, [data])
}
