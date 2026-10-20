import type { ExerciseLocal } from '../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../data/workoutRepo'
import { MUSCLE_GROUPS, type MuscleGroup } from './muscleGroups'

export type SetLog = SetLocal

/** Epley: weight x (1 + reps / 30). Zero reps gives 0. */
export const e1rm = (weightKg: number, reps: number): number => (reps <= 0 ? 0 : weightKg * (1 + reps / 30))

const setE1rm = (s: SetLog) => e1rm(s.weightKg, s.reps)

/** Drops and rest-pauses (sub-sets under a set) count for volume but never for records or e1RM. */
const isSubSet = (s: SetLog) => s.parentSetId !== null

/** Set with the highest e1RM, ignoring warm-ups and sub-sets; null when none counts. */
export function bestSet(sets: SetLog[]): SetLog | null {
  let best: SetLog | null = null
  for (const s of sets) {
    if (s.kind === 'warmup' || isSubSet(s)) continue
    if (!best || setE1rm(s) > setE1rm(best)) best = s
  }
  return best
}

export interface PR {
  exerciseId: string
  kind: 'maxWeight' | 'maxE1rm'
  value: number
  previous: number
  setId: string
}

function byExercise(sets: SetLog[]): Map<string, SetLog[]> {
  const map = new Map<string, SetLog[]>()
  for (const s of sets) {
    if (s.kind === 'warmup' || isSubSet(s)) continue
    const list = map.get(s.exerciseId) ?? []
    list.push(s)
    map.set(s.exerciseId, list)
  }
  return map
}

const EPSILON = 0.01

/**
 * `history` must NOT contain the current session's sets (filter by session before calling).
 * Records set in the current session versus the history: per exercise, a heavier set (`maxWeight`) and a higher e1RM
 * (`maxE1rm`). An exercise with no history has nothing to beat, so it yields no PR. Warm-ups and sets with 0 reps never count; a record must beat the old value by more than 0.01.
 */
export function sessionPRs(current: SetLog[], history: SetLog[]): PR[] {
  const counts = (s: SetLog) => s.reps > 0
  const past = byExercise(history.filter(counts))
  const prs: PR[] = []
  for (const [exerciseId, sets] of byExercise(current.filter(counts))) {
    const before = past.get(exerciseId)
    if (!before) continue
    const prevWeight = Math.max(...before.map((s) => s.weightKg))
    const prevE1rm = Math.max(...before.map(setE1rm))
    const heaviest = sets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a))
    if (heaviest.weightKg > prevWeight + EPSILON) prs.push({ exerciseId, kind: 'maxWeight', value: heaviest.weightKg, previous: prevWeight, setId: heaviest.id })
    const top = bestSet(sets)
    if (top && setE1rm(top) > prevE1rm + EPSILON) prs.push({ exerciseId, kind: 'maxE1rm', value: setE1rm(top), previous: prevE1rm, setId: top.id })
  }
  return prs
}

export interface Trend {
  exerciseId: string
  name: string
  firstE1rm: number
  lastE1rm: number
  /** lastE1rm - firstE1rm. */
  delta: number
  sessions: number
}

export type GroupTrends = { best: Trend[]; worst: Trend[] }

/**
 * Per muscle group, e1RM change of each exercise between its first and last session in `[from, to]` (needs at least
 * 2 sessions; the best set of each session). `best` = top 2 by delta; `worst` = bottom 2 among the rest, only those with delta < 0. Empty lists mean
 * "sem dados".
 */
export function strengthByGroup(
  sessions: SessionLocal[],
  sets: SetLog[],
  exercises: ExerciseLocal[],
  from: string,
  to: string,
): Record<MuscleGroup, GroupTrends> {
  const result = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, { best: [], worst: [] }])) as unknown as Record<MuscleGroup, GroupTrends>
  const inRange = sessions.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt))
  const order = new Map(inRange.map((s, i) => [s.id, i]))
  const setsBySession = new Map<string, SetLog[]>()
  for (const s of sets) {
    if (!order.has(s.sessionId)) continue
    const list = setsBySession.get(s.sessionId) ?? []
    list.push(s)
    setsBySession.set(s.sessionId, list)
  }

  const perExercise = new Map<string, number[]>()
  for (const session of inRange) {
    for (const [exerciseId, exSets] of byExercise(setsBySession.get(session.id) ?? [])) {
      const best = bestSet(exSets)
      if (!best) continue
      const list = perExercise.get(exerciseId) ?? []
      list.push(setE1rm(best))
      perExercise.set(exerciseId, list)
    }
  }

  const trends = new Map<MuscleGroup, Trend[]>()
  for (const exercise of exercises) {
    const values = perExercise.get(exercise.id)
    if (!values || values.length < 2) continue
    const firstE1rm = values[0]
    const lastE1rm = values[values.length - 1]
    const list = trends.get(exercise.primaryMuscleGroup) ?? []
    list.push({ exerciseId: exercise.id, name: exercise.name, firstE1rm, lastE1rm, delta: lastE1rm - firstE1rm, sessions: values.length })
    trends.set(exercise.primaryMuscleGroup, list)
  }

  for (const [group, list] of trends) {
    const desc = [...list].sort((a, b) => b.delta - a.delta)
    const best = desc.slice(0, 2)
    const worst = desc.slice(2).filter((t) => t.delta < 0).reverse().slice(0, 2)
    result[group] = { best, worst }
  }
  return result
}
