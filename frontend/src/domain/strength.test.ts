import { describe, expect, it } from 'vitest'
import type { ExerciseLocal } from '../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../data/workoutRepo'
import { bestSet, e1rm, strengthByGroup } from './strength'

let n = 0
const set = (sessionId: string, exerciseId: string, weightKg: number, reps: number, kind: SetLocal['kind'] = 'normal'): SetLocal => ({
  id: `set${++n}`, sessionId, exerciseId, plannedExerciseKey: null, setIndex: 0, weightKg, reps, kind, parentSetId: null,
  completedAt: '2026-10-20T10:00:00Z', clientUpdatedAt: '2026-10-20T10:00:00Z', rpe: null,
})
const session = (id: string, date: string): SessionLocal => ({
  id, date, planVersionId: 'v1', dayKey: 'A', startedAt: `${date}T10:00:00Z`, endedAt: null, note: null, exerciseNotes: {}, clientUpdatedAt: `${date}T10:00:00Z`,
  source: 'app', externalTitle: null,
})
const exercise = (id: string, name: string, primaryMuscleGroup: ExerciseLocal['primaryMuscleGroup']): ExerciseLocal => ({
  id, name, normalizedName: name.toLowerCase(), primaryMuscleGroup, aliases: [], catalogId: null,
})

describe('e1rm', () => {
  it('uses Epley', () => {
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 2)
    expect(e1rm(100, 0)).toBe(0)
    expect(e1rm(100, 1)).toBeCloseTo(103.33, 2)
  })
})

describe('bestSet', () => {
  it('picks the highest e1RM and ignores warm-ups', () => {
    const sets = [set('s', 'x', 60, 10), set('s', 'x', 100, 5), set('s', 'x', 200, 10, 'warmup')]
    expect(bestSet(sets)).toBe(sets[1])
    expect(bestSet([set('s', 'x', 50, 5, 'warmup')])).toBeNull()
    expect(bestSet([])).toBeNull()
  })

  it('drops and rest-pauses (sub-sets) are never the best set', () => {
    const parent = set('c', 'x', 90, 5)
    const sub = { ...set('c', 'x', 120, 12, 'rest_pause'), parentSetId: parent.id }
    expect(bestSet([parent, sub])).toBe(parent)
  })
})

describe('strengthByGroup', () => {
  const exercises = [exercise('bench', 'Supino', 'chest'), exercise('fly', 'Crucifixo', 'chest'), exercise('row', 'Remada', 'back')]
  const sessions = [session('s1', '2026-10-20'), session('s2', '2026-10-27'), session('s3', '2026-11-03')]

  it('has no data with a single session', () => {
    const out = strengthByGroup([sessions[0]], [set('s1', 'bench', 100, 10)], exercises, '2026-10-01', '2026-11-30')
    expect(out.chest).toEqual({ best: [], worst: [] })
    expect(Object.keys(out)).toHaveLength(14)
  })

  it('uses first vs last session of the range, best non-warmup set each', () => {
    const sets = [
      set('s1', 'bench', 100, 10), set('s1', 'bench', 150, 10, 'warmup'),
      set('s2', 'bench', 105, 10),
      set('s3', 'bench', 110, 10),
      set('s1', 'fly', 40, 10), set('s3', 'fly', 30, 10),
      set('s1', 'row', 80, 10),
    ]
    const out = strengthByGroup(sessions, sets, exercises, '2026-10-01', '2026-11-30')
    expect(out.chest.best.map((t) => t.exerciseId)).toEqual(['bench', 'fly'])
    expect(out.chest.best[0].delta).toBeCloseTo(e1rm(110, 10) - e1rm(100, 10), 5)
    expect(out.chest.best[0].sessions).toBe(3)
    expect(out.chest.worst).toEqual([])
    expect(out.back.best).toEqual([]) // one session only
  })

  it('splits best 2 / worst 2 and respects the range', () => {
    const ex = ['a', 'b', 'c', 'd', 'e'].map((id) => exercise(id, id, 'quads'))
    const gains: Record<string, number> = { a: 50, b: 40, c: 10, d: -5, e: -20 }
    const sets = ex.flatMap((e) => [set('s1', e.id, 100, 10), set('s2', e.id, 100 + gains[e.id], 10)])
    const out = strengthByGroup(sessions, sets, ex, '2026-10-20', '2026-10-27')
    expect(out.quads.best.map((t) => t.exerciseId)).toEqual(['a', 'b'])
    expect(out.quads.worst.map((t) => t.exerciseId)).toEqual(['e', 'd'])
    const narrow = strengthByGroup(sessions, sets, ex, '2026-10-21', '2026-11-30')
    expect(narrow.quads.best).toEqual([])
  })
})

describe('strengthByGroup edge cases', () => {
  it('worst only holds negative deltas', () => {
    const ex = ['a', 'b', 'c'].map((id) => exercise(id, id, 'back'))
    const ss = [session('s1', '2026-10-20'), session('s2', '2026-10-27')]
    const sets = ex.flatMap((e, i) => [set('s1', e.id, 100, 10), set('s2', e.id, 100 + (i + 1) * 5, 10)])
    const out = strengthByGroup(ss, sets, ex, '2026-10-01', '2026-11-30')
    expect(out.back.best).toHaveLength(2)
    expect(out.back.worst).toEqual([])
  })
})
