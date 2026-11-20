import { describe, expect, it } from 'vitest'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import type { ProtocolDocument } from '../../domain/planDocuments'
import type { WorkoutPlanAt } from '../../domain/rotation'
import { e1rm } from '../../domain/strength'
import { buildSummary } from '../summary/summaryData'
import { buildTrainingStats, type TrainingStatsInput } from './trainingStats'

// Tuesday.
const TODAY = '2026-10-27'

const protocolDoc: ProtocolDocument = {
  updateDate: '2026-12-05',
  billingDate: '2026-11-05',
  meals: [],
  items: [],
  guidelines: [],
}

// Mon, Tue, Thu train.
const plan: WorkoutPlanAt = {
  planVersionId: 'p1',
  activatedOn: '2026-09-01',
  rotation: { type: 'fixed_weekdays', map: { mon: 'a', tue: 'a', wed: 'off', thu: 'a', fri: 'off', sat: 'off', sun: 'off' } },
}

const session = (date: string, over: Partial<SessionLocal> = {}): SessionLocal => ({
  id: `s-${date}`, date, planVersionId: 'p1', dayKey: 'a', startedAt: `${date}T12:00:00.000Z`, endedAt: `${date}T13:00:00.000Z`, note: null,
  exerciseNotes: {}, clientUpdatedAt: `${date}T13:00:00.000Z`, source: 'hevy', externalTitle: null, ...over,
})

let setSeq = 0
const set = (sessionId: string, over: Partial<SetLocal> = {}): SetLocal => ({
  id: `set-${++setSeq}`, sessionId, exerciseId: 'e1', plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind: 'normal',
  parentSetId: null, completedAt: '2026-10-20T12:30:00.000Z', clientUpdatedAt: '2026-10-20T12:30:00.000Z', rpe: null, ...over,
})

const exercise = (id: string, name: string): ExerciseLocal => ({ id, name, normalizedName: name.toLowerCase(), primaryMuscleGroup: 'chest', aliases: [], catalogId: null })

const withSets = (...dates: string[]) => ({ sessions: dates.map((d) => session(d)), sets: dates.map((d) => set(`s-${d}`)) })

const input = (over: Partial<TrainingStatsInput> = {}): TrainingStatsInput => ({
  protocol: { activatedOn: '2026-10-19', document: protocolDoc },
  plans: [plan],
  overrides: [],
  sessions: [],
  sets: [],
  exercises: [],
  ...over,
})

describe('buildTrainingStats', () => {
  it('counts, per week starting on Monday, the workouts done and planned up to today', () => {
    // Week of the 19th: Mon 19, Tue 20, Thu 22 planned (3); done on the 19th and 22nd.
    const s = buildTrainingStats(input(withSets('2026-10-19', '2026-10-22')), TODAY)
    expect(s.weeks).toEqual([
      { weekStart: '2026-10-19', done: 2, planned: 3 },
      { weekStart: '2026-10-26', done: 0, planned: 2 },
    ])
  })

  it('a session with only warm-up sets does not count as done', () => {
    const s = buildTrainingStats(
      input({ sessions: [session('2026-10-19'), session('2026-10-20')], sets: [set('s-2026-10-19'), set('s-2026-10-20', { kind: 'warmup' })] }),
      TODAY,
    )
    expect(s.weeks[0]).toEqual({ weekStart: '2026-10-19', done: 1, planned: 3 })
    expect(s.calendar.find((d) => d.date === '2026-10-20')?.state).toBe('missed')
  })

  it('a day override changes what is planned', () => {
    // Wednesday 21 becomes a workout day; Thursday 22 becomes rest.
    const s = buildTrainingStats(
      input({ overrides: [{ date: '2026-10-21', dayKey: 'a' }, { date: '2026-10-22', dayKey: 'off' }, { date: '2026-10-23', dayKey: 'a' }] }),
      TODAY,
    )
    expect(s.weeks[0]).toEqual({ weekStart: '2026-10-19', done: 0, planned: 4 })
    expect(s.calendar.find((d) => d.date === '2026-10-22')?.planned).toBe(false)
  })

  it('an open session (never finished) with a working set counts as done', () => {
    const s = buildTrainingStats(input({ sessions: [session('2026-10-20', { endedAt: null, source: 'app' })], sets: [set('s-2026-10-20')] }), TODAY)
    expect(s.weeks[0].done).toBe(1)
    expect(s.calendar.find((d) => d.date === '2026-10-20')?.state).toBe('done')
  })

  it('a cycle starting mid-week only counts its own days in the first week', () => {
    // Starts on Tuesday 20: Monday 19 is outside (neither planned nor done).
    const s = buildTrainingStats(input({ protocol: { activatedOn: '2026-10-20', document: protocolDoc }, ...withSets('2026-10-19', '2026-10-20') }), TODAY)
    expect(s.weeks[0]).toEqual({ weekStart: '2026-10-19', done: 1, planned: 2 })
    expect(s.calendar[0].date).toBe('2026-10-20')
  })

  it('stops at the update date once the cycle is over', () => {
    const doc = { ...protocolDoc, updateDate: '2026-10-22' }
    const s = buildTrainingStats(input({ protocol: { activatedOn: '2026-10-19', document: doc }, ...withSets('2026-10-19', '2026-10-26') }), TODAY)
    expect(s.weeks).toEqual([{ weekStart: '2026-10-19', done: 1, planned: 3 }])
    expect(s.calendar.at(-1)?.date).toBe('2026-10-22')
  })

  it('before the cycle starts there are no weeks', () => {
    const s = buildTrainingStats(input({ protocol: { activatedOn: '2026-11-02', document: protocolDoc } }), TODAY)
    expect(s.weeks).toEqual([])
    expect(s.trends).toEqual([])
  })

  it('without a protocol uses the last 8 weeks up to today', () => {
    const s = buildTrainingStats(input({ protocol: null, ...withSets('2026-09-06', '2026-09-07', '2026-10-26') }), TODAY)
    expect(s.weeks).toHaveLength(8)
    expect(s.weeks[0]).toEqual({ weekStart: '2026-09-07', done: 1, planned: 3 })
    expect(s.weeks.at(-1)).toEqual({ weekStart: '2026-10-26', done: 1, planned: 2 })
    expect(s.calendar[0].date).toBe('2026-09-07')
    expect(s.calendar.at(-1)?.date).toBe(TODAY)
    // The 6th (a Sunday, before the 8 weeks) is out.
    expect(s.weeks.reduce((n, w) => n + w.done, 0)).toBe(2)
  })

  it('without a protocol nor a workout plan has no planned days and no error', () => {
    const s = buildTrainingStats(input({ protocol: null, plans: [] }), TODAY)
    expect(s.weeks).toHaveLength(8)
    expect(s.weeks.every((w) => w.planned === 0 && w.done === 0)).toBe(true)
    expect(s.calendar.every((d) => !d.planned)).toBe(true)
    expect(s.trends).toEqual([])
  })

  it('trends: the 6 exercises with most sessions in the period (tie by name), points by date from the best set', () => {
    const names = ['Supino', 'Agachamento', 'Remada', 'Desenvolvimento', 'Rosca', 'Tríceps', 'Leg press']
    const exercises = names.map((n, i) => exercise(`e${i}`, n))
    // e0 in 4 sessions, e1..e5 in 2 sessions, e6 (Leg press) in 2 sessions too -> tie on 2 sessions decided by name.
    const dates = ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-26']
    // Out of order on purpose: points must come out sorted by date.
    const sessions = [...dates].reverse().map((d) => session(d))
    const sets: SetLocal[] = []
    dates.forEach((d, i) => {
      sets.push(set(`s-${d}`, { exerciseId: 'e0', weightKg: 60 + i, reps: 5 }))
      sets.push(set(`s-${d}`, { exerciseId: 'e0', weightKg: 40 + i, reps: 5 }))
      sets.push(set(`s-${d}`, { exerciseId: 'e0', weightKg: 200, reps: 10, kind: 'warmup' }))
    })
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']) {
      sets.push(set('s-2026-10-19', { exerciseId: id }))
      sets.push(set('s-2026-10-20', { exerciseId: id }))
    }
    // Only a warm-up on another day: no session for e6 there.
    sets.push(set('s-2026-10-22', { exerciseId: 'e6', kind: 'warmup' }))

    const s = buildTrainingStats(input({ sessions, sets, exercises }), TODAY)
    expect(s.trends.map((t) => t.name)).toEqual(['Supino', 'Agachamento', 'Desenvolvimento', 'Leg press', 'Remada', 'Rosca'])
    const top = s.trends[0]
    expect(top).toMatchObject({ exerciseId: 'e0', name: 'Supino', sessions: 4 })
    expect(top.points.map((p) => p.date)).toEqual(dates)
    expect(top.points.map((p) => p.value)).toEqual([60, 61, 62, 63].map((w) => e1rm(w, 5)))
  })

  it('trends only use sessions inside the period', () => {
    const exercises = [exercise('e1', 'Supino')]
    const s = buildTrainingStats(input({ exercises, ...withSets('2026-10-12', '2026-10-19') }), TODAY)
    expect(s.trends).toEqual([{ exerciseId: 'e1', name: 'Supino', sessions: 1, points: [{ date: '2026-10-19', value: e1rm(50, 10) }] }])
  })

  it('the calendar is the same as the summary for the same input', () => {
    const base = {
      protocol: { activatedOn: '2026-10-19', document: protocolDoc },
      plans: [plan],
      overrides: [{ date: '2026-10-21', dayKey: 'a' }],
      sessions: [session('2026-10-19'), session('2026-10-21'), session('2026-10-22')],
      sets: [set('s-2026-10-19'), set('s-2026-10-21'), set('s-2026-10-22', { kind: 'warmup' })],
      exercises: [],
    }
    const summary = buildSummary({ ...base, checkins: [] }, TODAY)
    expect(buildTrainingStats(base, TODAY).calendar).toEqual(summary.calendar)
  })
})
