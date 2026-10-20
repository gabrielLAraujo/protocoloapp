import { describe, expect, it } from 'vitest'
import type { ExerciseChangeLocal, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise, WorkoutDay } from '../../domain/planDocuments'
import { restDurations } from './restDurations'
import { bisetNext, bisetPartners, dayBlocks, restAfterSet, type FlowExercise } from './sessionFlow'

const ex = (key: string, over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  key,
  name: `Exercicio ${key}`,
  sets: [
    { repsMin: 8, repsMax: 10 },
    { repsMin: 8, repsMax: 10 },
  ],
  restSeconds: 60,
  ...over,
})

const day = (exercises: PlannedExercise[]): WorkoutDay => ({ key: 'a', name: 'Treino A', exercises })

let clock = 0
const set = (key: string, over: Partial<SetLocal> = {}): SetLocal => {
  clock += 1
  return {
    id: `${key}-${clock}`,
    sessionId: 'x',
    exerciseId: key,
    plannedExerciseKey: key,
    setIndex: 0,
    weightKg: 50,
    reps: 10,
    kind: 'normal',
    parentSetId: null,
    completedAt: new Date(Date.UTC(2026, 9, 18, 12, 0, clock)).toISOString(),
    clientUpdatedAt: '',
    ...over,
  }
}

const flow = (planned: PlannedExercise, sets: SetLocal[]): FlowExercise => ({ planned, sets, name: planned.name })
const change = (key: string, action: 'skipped' | 'swapped'): ExerciseChangeLocal => ({
  id: `c-${key}`,
  sessionId: 'x',
  plannedExerciseKey: key,
  action,
  replacementExerciseId: null,
  note: null,
  clientUpdatedAt: '',
})

describe('bisetPartners / dayBlocks', () => {
  it('pairs both ways when only one exercise declares the bi-set, also through the legacy supersetWith', () => {
    const d = day([ex('a1', { techniques: [{ type: 'biset', with: 'a3' }] }), ex('a2'), ex('a3'), ex('a4', { supersetWith: 'a2' })])
    const partners = bisetPartners(d)
    expect(partners.get('a1')).toBe('a3')
    expect(partners.get('a3')).toBe('a1')
    expect(partners.get('a2')).toBe('a4')
    const blocks = dayBlocks(d, new Map())
    expect(blocks.map((b) => (b.type === 'biset' ? `${b.a.key}+${b.b.key}` : b.planned.key))).toEqual(['a1+a3', 'a2+a4'])
  })

  it('a partner that cannot be done (not in the catalog) ends the pairing like a skip', () => {
    const d = day([ex('a1', { techniques: [{ type: 'biset', with: 'a2' }] }), ex('a2')])
    const blocks = dayBlocks(d, new Map(), (p) => p.key !== 'a2')
    expect(blocks.map((b) => (b.type === 'single' ? [b.planned.key, b.endedWith] : 'biset'))).toEqual([
      ['a1', 'Exercicio a2'],
      ['a2', 'Exercicio a1'],
    ])
  })

  it('ignores a partner that is not in the day or the exercise itself', () => {
    const d = day([ex('a1', { supersetWith: 'zz' }), ex('a2', { techniques: [{ type: 'biset', with: 'a2' }] })])
    expect(bisetPartners(d).size).toBe(0)
  })

  it('a skip or a swap ends the pairing: both get their own card with the note', () => {
    const d = day([ex('a1', { techniques: [{ type: 'biset', with: 'a2' }] }), ex('a2')])
    for (const action of ['skipped', 'swapped'] as const) {
      const blocks = dayBlocks(d, new Map([['a2', change('a2', action)]]))
      expect(blocks).toEqual([
        { type: 'single', planned: d.exercises[0], endedWith: 'Exercicio a2' },
        { type: 'single', planned: d.exercises[1], endedWith: 'Exercicio a1' },
      ])
    }
  })
})

describe('restAfterSet', () => {
  it('drop next: no rest; rest-pause next: 15 s; after the last sub-set: the normal rest of that set', () => {
    const planned = ex('a1', {
      restSequence: [90, 120],
      sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 6, repsMax: 8, restPause: 1, drops: 1 }],
    })
    const s0 = set('a1')
    const s1 = set('a1', { setIndex: 1 })
    const go = (sets: SetLocal[], parentId: string) => restAfterSet({ exercise: flow(planned, sets), partner: null, parentId, dismissed: new Set() })

    expect(go([s0], s0.id)).toEqual({ kind: 'rest', durations: [90, 120], index: 0, label: 'Exercicio a1' })
    expect(go([s0, s1], s1.id)).toEqual({ kind: 'rest', durations: [15], index: 0, label: 'Exercicio a1 — rest-pause' })
    const rp = set('a1', { setIndex: 1, kind: 'rest_pause', parentSetId: s1.id })
    expect(go([s0, s1, rp], s1.id)).toEqual({ kind: 'skip' })
    const drop = set('a1', { setIndex: 1, kind: 'drop', parentSetId: s1.id })
    expect(go([s0, s1, rp, drop], s1.id)).toEqual({ kind: 'rest', durations: [90, 120], index: 1, label: 'Exercicio a1' })
  })

  it('without a planned rest it leaves the timer alone', () => {
    const planned = ex('a1', { restSeconds: null })
    const s0 = set('a1')
    expect(restAfterSet({ exercise: flow(planned, [s0]), partner: null, parentId: s0.id, dismissed: new Set() })).toEqual({ kind: 'keep' })
  })

  it('bi-set: A → straight to B; B → the longer rest of the two, then A again', () => {
    const a = ex('a1', { restSeconds: 60 })
    const b = ex('a2', { restSeconds: 90 })
    const a1 = set('a1')
    expect(restAfterSet({ exercise: flow(a, [a1]), partner: flow(b, []), parentId: a1.id, dismissed: new Set() })).toEqual({ kind: 'skip' })
    const b1 = set('a2')
    expect(restAfterSet({ exercise: flow(b, [b1]), partner: flow(a, [a1]), parentId: b1.id, dismissed: new Set() })).toEqual({
      kind: 'rest',
      durations: [90],
      index: 0,
      label: 'Bi-set: Exercicio a2 + Exercicio a1',
    })
  })

  it('bi-set: the exercise with more sets rests on its own rest once the other has no sets left', () => {
    const a = ex('a1', { restSeconds: 60, sets: [{ repsMin: 8, repsMax: 10 }, { repsMin: 8, repsMax: 10 }, { repsMin: 8, repsMax: 10 }] })
    // The partner's rest is the longer one: it must not apply to a round the partner is not in.
    const b = ex('a2', { restSeconds: 120 })
    const aSets = [set('a1'), set('a1', { setIndex: 1 }), set('a1', { setIndex: 2 })]
    const bSets = [set('a2'), set('a2', { setIndex: 1 })]
    expect(restAfterSet({ exercise: flow(a, aSets), partner: flow(b, bSets), parentId: aSets[2]!.id, dismissed: new Set() })).toMatchObject({
      kind: 'rest',
      durations: [60],
      index: 2,
      label: 'Exercicio a1',
    })
  })
})

describe('bisetNext', () => {
  it('alternates A1 → B1 → A2, a pending sub-set first, null at the end', () => {
    const a = ex('a1', { techniques: [{ type: 'drop', count: 1, sets: 'last' }] })
    const b = ex('a2')
    const none = new Set<string>()
    expect(bisetNext(flow(a, []), flow(b, []), none)).toEqual({ which: 'a', slot: null, setNumber: 1 })
    const a1 = set('a1')
    expect(bisetNext(flow(a, [a1]), flow(b, []), none)).toEqual({ which: 'b', slot: null, setNumber: 1 })
    const b1 = set('a2')
    expect(bisetNext(flow(a, [a1]), flow(b, [b1]), none)).toEqual({ which: 'a', slot: null, setNumber: 2 })
    const a2 = set('a1', { setIndex: 1 })
    expect(bisetNext(flow(a, [a1, a2]), flow(b, [b1]), none)).toMatchObject({ which: 'a', slot: { kind: 'drop', ordinal: 1 }, setNumber: 2 })
    const d2 = set('a1', { setIndex: 1, kind: 'drop', parentSetId: a2.id })
    expect(bisetNext(flow(a, [a1, a2, d2]), flow(b, [b1]), none)).toEqual({ which: 'b', slot: null, setNumber: 2 })
    const b2 = set('a2', { setIndex: 1 })
    expect(bisetNext(flow(a, [a1, a2, d2]), flow(b, [b1, b2]), none)).toBeNull()
  })
})

describe('restDurations', () => {
  it('uses the SST intervals when there is no rest sequence', () => {
    // Intervals between the sets, the exercise's own rest after the last one.
    expect(restDurations(ex('a1', { restSeconds: 90, techniques: [{ type: 'sst', rests: [10, 20] }] }))).toEqual([10, 90])
    const three = { repsMin: 8, repsMax: 10 }
    expect(restDurations(ex('a1', { restSeconds: null, sets: [three, three, three], techniques: [{ type: 'sst', rests: [15] }] }))).toEqual([15, 15, 0])
    expect(restDurations(ex('a1', { restSequence: [30, 40], techniques: [{ type: 'sst', rests: [10] }] }))).toEqual([30, 40])
  })
})
