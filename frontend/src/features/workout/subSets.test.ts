import { describe, expect, it } from 'vitest'
import type { SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise } from '../../domain/planDocuments'
import { dropLoad, finishedRounds, isDismissed, openSlots, plannedSubSets, splitSets, subSetSlots } from './subSets'
import { volumeOf } from './volume'

const exercise = (over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  key: 'e1',
  name: 'Exercicio Ficticio',
  sets: [
    { repsMin: 8, repsMax: 10 },
    { repsMin: 8, repsMax: 10 },
    { repsMin: 6, repsMax: 8 },
  ],
  ...over,
})

let clock = 0
const set = (over: Partial<SetLocal>): SetLocal => {
  clock += 1
  return {
    id: `s${clock}`,
    sessionId: 'x',
    exerciseId: 'ex',
    plannedExerciseKey: 'e1',
    setIndex: 0,
    weightKg: 60,
    reps: 10,
    kind: 'normal',
    parentSetId: null,
    completedAt: new Date(Date.UTC(2026, 9, 18, 12, 0, clock)).toISOString(),
    clientUpdatedAt: '',
    ...over,
  }
}

describe('plannedSubSets', () => {
  it('uses the set drops/restPause, rest-pauses first then drops', () => {
    const planned = exercise({ sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8, drops: 2, restPause: 1 }] })
    expect(plannedSubSets(planned, 0)).toEqual([])
    expect(plannedSubSets(planned, 1)).toEqual(['rest_pause', 'drop', 'drop'])
    expect(plannedSubSets(planned, 5)).toEqual([])
  })

  it('falls back to the exercise techniques: drop last/all/indexes, rest-pause on the last set', () => {
    expect(plannedSubSets(exercise({ techniques: [{ type: 'drop', count: 1, sets: 'last' }] }), 1)).toEqual([])
    expect(plannedSubSets(exercise({ techniques: [{ type: 'drop', count: 1, sets: 'last' }] }), 2)).toEqual(['drop'])
    expect(plannedSubSets(exercise({ techniques: [{ type: 'drop', count: 2, sets: 'all' }] }), 0)).toEqual(['drop', 'drop'])
    expect(plannedSubSets(exercise({ techniques: [{ type: 'drop', count: 1, sets: [0, 2] }] }), 1)).toEqual([])
    expect(plannedSubSets(exercise({ techniques: [{ type: 'drop', count: 1, sets: [0, 2] }] }), 2)).toEqual(['drop'])
    const both = exercise({ techniques: [{ type: 'drop', count: 1, sets: 'last' }, { type: 'rest_pause', count: 2 }] })
    expect(plannedSubSets(both, 0)).toEqual([])
    expect(plannedSubSets(both, 2)).toEqual(['rest_pause', 'rest_pause', 'drop'])
  })

  it('set-level values win over the technique once any set has them', () => {
    const planned = exercise({
      sets: [{ repsMin: 8, repsMax: 10, drops: 1 }, { repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8 }],
      techniques: [{ type: 'drop', count: 3, sets: 'all' }],
    })
    expect(plannedSubSets(planned, 0)).toEqual(['drop'])
    expect(plannedSubSets(planned, 2)).toEqual([])
  })
})

describe('dropLoad', () => {
  it('is −20 % rounded to 1 kg and never negative', () => {
    expect(dropLoad(60)).toBe(48)
    expect(dropLoad(62.5)).toBe(50)
    expect(dropLoad(23)).toBe(18)
    expect(dropLoad(1)).toBe(1)
    expect(dropLoad(0)).toBe(0)
  })
})

describe('subSetSlots', () => {
  const planned = exercise({ techniques: [{ type: 'drop', count: 2, sets: 'last' }, { type: 'rest_pause', count: 1 }] })

  it('suggests rest-pause at the same load and each drop 20 % under the previous', () => {
    const parent = set({ setIndex: 2, weightKg: 100 })
    const slots = subSetSlots(planned, parent, [])
    expect(slots.map((s) => [s.kind, s.ordinal, s.suggestedKg, s.logged])).toEqual([
      ['rest_pause', 1, 100, undefined],
      ['drop', 1, 80, undefined],
      ['drop', 2, 64, undefined],
    ])
    expect(slots.map((s) => s.key)).toEqual([`${parent.id}:rest_pause:1`, `${parent.id}:drop:1`, `${parent.id}:drop:2`])
  })

  it('fills the slots with the stored sub-sets by kind and order; the next suggestion follows the load done', () => {
    const parent = set({ setIndex: 2, weightKg: 100 })
    const drop = set({ setIndex: 2, kind: 'drop', parentSetId: parent.id, weightKg: 70 })
    const slots = subSetSlots(planned, parent, [drop])
    expect(slots[0]!.logged).toBeUndefined()
    expect(slots[1]!.logged).toBe(drop)
    expect(slots[2]!.suggestedKg).toBe(56)
  })

  it('is a pure derivation: the same stored rows give the same slots (no duplicates on reopen)', () => {
    const parent = set({ setIndex: 2, weightKg: 100 })
    const children = [set({ setIndex: 2, kind: 'rest_pause', parentSetId: parent.id, weightKg: 100 })]
    expect(subSetSlots(planned, parent, children)).toEqual(subSetSlots(planned, parent, [...children]))
    expect(subSetSlots(planned, parent, children)).toHaveLength(3)
  })

  it('keeps stored sub-sets beyond the plan after the planned ones', () => {
    const parent = set({ setIndex: 0, weightKg: 50 })
    const extra = set({ setIndex: 0, kind: 'drop', parentSetId: parent.id, weightKg: 40 })
    const slots = subSetSlots(exercise(), parent, [extra])
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ kind: 'drop', ordinal: 1, planned: false, logged: extra })
  })
})

describe('isDismissed', () => {
  const planned = exercise({ techniques: [{ type: 'drop', count: 3, sets: 'last' }] })

  it('"Remover" on a slot hides it and the later slots of the same kind, never one with a stored sub-set', () => {
    const parent = set({ setIndex: 2, weightKg: 100 })
    const dismissed = new Set([`${parent.id}:drop:2`])
    const empty = subSetSlots(planned, parent, [])
    expect(empty.map((s) => isDismissed(dismissed, s))).toEqual([false, true, true])

    // Remover drop 1, yet a drop gets stored (another device, an old screen): it fills slot 1 and stays visible.
    const stored = set({ setIndex: 2, kind: 'drop', parentSetId: parent.id, weightKg: 80 })
    const slots = subSetSlots(planned, parent, [stored])
    const all = new Set([`${parent.id}:drop:1`])
    expect(slots.map((s) => isDismissed(all, s))).toEqual([false, true, true])
    expect(openSlots(planned, [parent, stored], all)).toEqual([])
    expect(finishedRounds(planned, [parent, stored], all)).toBe(1)
  })

  it('does not mix parents or kinds', () => {
    const parent = set({ setIndex: 2 })
    const slots = subSetSlots(planned, parent, [])
    expect(isDismissed(new Set(['other:drop:1', `${parent.id}:rest_pause:1`]), slots[0]!)).toBe(false)
  })
})

describe('openSlots / finishedRounds', () => {
  it('counts a set as finished once its sub-sets are done or removed', () => {
    const planned = exercise({ techniques: [{ type: 'drop', count: 1, sets: 'all' }] })
    const s0 = set({ setIndex: 0 })
    const d0 = set({ setIndex: 0, kind: 'drop', parentSetId: s0.id })
    const s1 = set({ setIndex: 1 })
    const sets = [s0, d0, s1]
    expect(openSlots(planned, sets, new Set()).map((o) => o.parent.id)).toEqual([s1.id])
    expect(finishedRounds(planned, sets, new Set())).toBe(1)
    expect(finishedRounds(planned, sets, new Set([`${s1.id}:drop:1`]))).toBe(2)
  })

  it('splitSets ignores sub-sets whose parent is gone', () => {
    const orphan = set({ kind: 'drop', parentSetId: 'missing' })
    expect(splitSets([orphan])).toEqual({ main: [], childrenOf: new Map() })
  })
})

describe('volume', () => {
  it('counts drops and rest-pauses like any working set (warm-ups excluded)', () => {
    const parent = set({ weightKg: 100, reps: 8 })
    const sets = [
      parent,
      set({ kind: 'rest_pause', parentSetId: parent.id, weightKg: 100, reps: 3 }),
      set({ kind: 'drop', parentSetId: parent.id, weightKg: 80, reps: 6 }),
      set({ kind: 'warmup', weightKg: 40, reps: 10 }),
    ]
    expect(volumeOf(sets)).toBe(800 + 300 + 480)
  })
})
