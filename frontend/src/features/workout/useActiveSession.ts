import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { finishSessionAndMark } from '../../data/adherenceLinks'
import type { Data } from '../../data/dataContext'
import { workoutRepo, type ExerciseChangeLocal, type SetKind, type SetLocal } from '../../data/workoutRepo'
import { useSync } from '../sync/syncContext'
import { nextLogTime } from './logDay'

/** The latest change wins for a planned exercise (a skip can be undone by swapping back). */
export function effectiveChanges(changes: ExerciseChangeLocal[]): Map<string, ExerciseChangeLocal> {
  const map = new Map<string, ExerciseChangeLocal>()
  for (const c of changes) map.set(c.plannedExerciseKey, c)
  return map
}

const now = () => new Date()

async function readSession(db: Data['db'], sessionId: string) {
  const [sets, changes] = await Promise.all([workoutRepo.setsForSession(db, sessionId), workoutRepo.changesForSession(db, sessionId)])
  return { sets, changes }
}

export interface LogSetInput {
  exerciseId: string
  plannedExerciseKey: string
  setIndex: number
  weightKg: number
  reps: number
  kind: SetKind
}

export interface SubSetInput {
  parentSetId: string
  kind: 'drop' | 'rest_pause'
  /** 1-based position among the parent's sub-sets of this kind. */
  ordinal: number
  weightKg: number
  reps: number
}

export interface ActiveSession {
  ready: boolean
  failed: boolean
  sets: SetLocal[]
  changes: Map<string, ExerciseChangeLocal>
  /** Per exercise, the working sets of the most recent other session ("Última vez"). */
  lastTime: Map<string, SetLocal[]>
  /** Stores a main set; resolves with the session's sets after the write. */
  logSet(input: LogSetInput): Promise<SetLocal[]>
  /** Stores a drop/rest-pause under a done set (idempotent per parent + kind + ordinal); resolves with the session's sets. */
  logSubSet(input: SubSetInput): Promise<SetLocal[]>
  removeSet(setId: string): Promise<void>
  updateSet(setId: string, weightKg: number, reps: number, kind: SetKind): Promise<void>
  /** Undoes the latest change (skip or swap) of a planned exercise. */
  clearChange(plannedKey: string): Promise<void>
  /** Saves the note of a planned exercise in this session (blank clears it). */
  saveExerciseNote(plannedKey: string, text: string): Promise<void>
  skipExercise(plannedKey: string, note: string | null): Promise<void>
  swapExercise(plannedKey: string, replacementExerciseId: string): Promise<void>
  /** Ends the session now (or at `at`). */
  finish(at?: Date): Promise<void>
}

/**
 * The sets and exercise changes of one session, read from the device (so a reload brings the session back as it was),
 * plus the actions that write them. Every write is followed by a sync attempt; it never blocks on the network.
 * `logFrom` (the session's start) is for a session written afterwards: new sets are timed on its day (nextLogTime), not now.
 */
export function useActiveSession(data: Data, sessionId: string, exerciseIds: string[], logFrom?: string): ActiveSession {
  // `exerciseIds`: the planned exercises; replacements already stored are added on their own.
  const { syncNow } = useSync()
  const [state, setState] = useState<{ sets: SetLocal[]; changes: ExerciseChangeLocal[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [lastTime, setLastTime] = useState<Map<string, SetLocal[]>>(new Map())
  const { db, userId } = data
  const setsNow = useRef<SetLocal[]>([])
  setsNow.current = state?.sets ?? []
  const completedAt = () => (logFrom === undefined ? undefined : nextLogTime(setsNow.current, logFrom))

  const reload = useCallback(async () => {
    const read = await readSession(db, sessionId)
    setState(read)
    return read
  }, [db, sessionId])

  useEffect(() => {
    let cancelled = false
    readSession(db, sessionId)
      .then((read) => {
        if (!cancelled) setState(read)
      })
      .catch((error: unknown) => {
        console.error('could not read the session', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [db, sessionId])

  // "Última vez": the newest session of each exercise other than this one.
  const replacementIds = (state?.changes ?? []).flatMap((c) => (c.replacementExerciseId ? [c.replacementExerciseId] : []))
  const idsKey = [...new Set([...exerciseIds, ...replacementIds])].sort().join(',')
  useEffect(() => {
    let cancelled = false
    const ids = idsKey === '' ? [] : idsKey.split(',')
    Promise.all(ids.map(async (id) => [id, await workoutRepo.setsForExercise(db, id, 200)] as const))
      .then((all) => {
        if (cancelled) return
        const map = new Map<string, SetLocal[]>()
        for (const [id, sets] of all) {
          const others = sets.filter((s) => s.sessionId !== sessionId && s.kind !== 'warmup')
          if (others.length === 0) continue
          const latest = others[0]!.sessionId
          map.set(
            id,
            others.filter((s) => s.sessionId === latest).sort((a, b) => a.setIndex - b.setIndex || a.completedAt.localeCompare(b.completedAt)),
          )
        }
        setLastTime(map)
      })
      .catch((error: unknown) => console.error('could not read the previous sets', error))
    return () => {
      cancelled = true
    }
  }, [db, sessionId, idsKey])

  const after = useCallback(async () => {
    const read = await reload()
    void syncNow()
    return read.sets
  }, [reload, syncNow])

  const changes = useMemo(() => effectiveChanges(state?.changes ?? []), [state])

  return {
    ready: state !== null,
    failed,
    sets: state?.sets ?? [],
    changes,
    lastTime,
    async logSet(input) {
      await workoutRepo.logSet(db, userId, { sessionId, ...input, completedAt: completedAt() }, now())
      return after()
    },
    async logSubSet(input) {
      await workoutRepo.logSubSet(db, userId, { ...input, completedAt: completedAt() }, now())
      return after()
    },
    async removeSet(setId) {
      await workoutRepo.deleteSet(db, userId, setId, now())
      await after()
    },
    async updateSet(setId, weightKg, reps, kind) {
      await workoutRepo.updateSet(db, userId, setId, { weightKg, reps, kind }, now())
      await after()
    },
    async clearChange(plannedKey) {
      const change = changes.get(plannedKey)
      if (!change) return
      await workoutRepo.removeChange(db, userId, change.id, now())
      await after()
    },
    async saveExerciseNote(plannedKey, text) {
      await workoutRepo.setExerciseNote(db, userId, sessionId, plannedKey, text, now())
      void syncNow()
    },
    async skipExercise(plannedKey, note) {
      await workoutRepo.recordChange(db, userId, { sessionId, plannedExerciseKey: plannedKey, action: 'skipped', note }, now())
      await after()
    },
    async swapExercise(plannedKey, replacementExerciseId) {
      await workoutRepo.recordChange(db, userId, { sessionId, plannedExerciseKey: plannedKey, action: 'swapped', replacementExerciseId }, now())
      await after()
    },
    async finish(at) {
      const time = now()
      await finishSessionAndMark(db, userId, sessionId, at ?? time, time)
      void syncNow()
    },
  }
}
