import { describe, expect, it } from 'vitest'
import type { AdherenceLogLocal } from '../../data/adherenceRepo'
import type { DailyCheckin } from '../../data/dailyCheckinRepo'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import type { DayWorkoutPlan } from '../../domain/dayPlan'
import type { ProtocolDocument } from '../../domain/planDocuments'
import type { WorkoutPlanAt } from '../../domain/rotation'
import { adherenceRates, buildSummary, formatRate, type SummaryInput } from './summaryData'

const TODAY = '2026-10-27'
const protocolDoc = (extra: Partial<ProtocolDocument> = {}): ProtocolDocument => ({
  updateDate: '2026-11-15',
  billingDate: '2026-11-05',
  meals: [],
  items: [],
  guidelines: [{ kind: 'water_min_l', value: 3 }],
  cardio: { daily: true },
  ...extra,
})

// Mon, Tue, Thu, Fri, Sat train: from 2026-10-20 to 2026-10-27 that is 20, 22, 23, 24, 26, 27 (six days).
const plan: WorkoutPlanAt = {
  planVersionId: 'p1',
  activatedOn: '2026-10-01',
  rotation: { type: 'fixed_weekdays', map: { mon: 'a', tue: 'a', wed: 'off', thu: 'a', fri: 'a', sat: 'a', sun: 'off' } },
}

const session = (date: string, id = `s-${date}`): SessionLocal => ({
  id, date, planVersionId: 'p1', dayKey: 'a', startedAt: `${date}T12:00:00.000Z`, endedAt: `${date}T13:00:00.000Z`, note: null, exerciseNotes: {}, clientUpdatedAt: `${date}T13:00:00.000Z`,
})

const workingSet = (sessionId: string, kind: SetLocal['kind'] = 'normal'): SetLocal => ({
  id: `${sessionId}-${kind}`, sessionId, exerciseId: 'e1', plannedExerciseKey: 'e1', setIndex: 0, weightKg: 50, reps: 10, kind,
  parentSetId: null, completedAt: '2026-10-20T12:30:00.000Z', clientUpdatedAt: '2026-10-20T12:30:00.000Z',
})
const withSets = (...dates: string[]) => ({ sessions: dates.map((d) => session(d)), sets: dates.map((d) => workingSet(`s-${d}`)) })

const checkin = (date: string, over: Partial<DailyCheckin> = {}): DailyCheckin => ({
  id: `c-${date}`, date, sleepQuality: 4, bowel: 'normal', energyWake: 3, energyDay: 4, anxiety: 2, waterL: 3, weightKg: null, note: null,
  cardioDone: false, cardioMinutes: null, clientUpdatedAt: `${date}T08:00:00.000Z`, ...over,
})

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  protocol: { activatedOn: '2026-10-20', document: protocolDoc() },
  plans: [plan],
  overrides: [],
  sessions: [],
  sets: [],
  checkins: [],
  exercises: [],
  ...over,
})

describe('buildSummary', () => {
  it('counts workouts done and planned up to today and marks missed days', () => {
    const s = buildSummary(input(withSets('2026-10-20', '2026-10-22', '2026-10-23', '2026-10-26')), TODAY)
    expect(s.workouts).toEqual({ done: 4, planned: 6 })
    expect(s.cycle?.daysLeft).toBe(19)
    const state = (d: string) => s.calendar.find((c) => c.date === d)?.state
    expect(state('2026-10-20')).toBe('done')
    expect(state('2026-10-24')).toBe('missed')
    expect(state('2026-10-21')).toBe('rest')
    expect(state('2026-10-27')).toBe('today')
    expect(state('2026-10-28')).toBe('future')
    expect(s.calendar[0].date).toBe('2026-10-20')
    expect(s.calendar.at(-1)?.date).toBe('2026-11-15')
  })

  it('a session without working sets (empty or warm-up only) is not a workout done', () => {
    const s = buildSummary(
      input({
        sessions: [session('2026-10-20'), session('2026-10-22'), session('2026-10-23')],
        sets: [workingSet('s-2026-10-20'), workingSet('s-2026-10-22', 'warmup')],
      }),
      TODAY,
    )
    expect(s.workouts).toEqual({ done: 1, planned: 6 })
    const state = (d: string) => s.calendar.find((c) => c.date === d)?.state
    expect(state('2026-10-20')).toBe('done')
    expect(state('2026-10-22')).toBe('missed')
    expect(state('2026-10-23')).toBe('missed')
    expect(s.calendar.find((c) => c.date === '2026-10-22')?.done).toBe(false)
  })

  it('daily cardio plans one session per elapsed day', () => {
    const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24', '2026-10-26']
    const s = buildSummary(input({ checkins: days.map((d) => checkin(d, { cardioDone: true, cardioMinutes: 30 })) }), TODAY)
    expect(s.cardio).toEqual({ done: 5, planned: 8 })
    expect(s.calendar.filter((c) => c.cardio).map((c) => c.date)).toEqual(days)
  })

  it('weekly cardio rounds down sessionsPerWeek x elapsed weeks', () => {
    const s = buildSummary(input({ protocol: { activatedOn: '2026-10-20', document: protocolDoc({ cardio: { sessionsPerWeek: 4 } }) } }), TODAY)
    expect(s.cardio.planned).toBe(4) // 4 * 8/7 = 4.57
  })

  it('averages check-ins with one decimal and lists the weight series', () => {
    const s = buildSummary(
      input({
        checkins: [
          checkin('2026-10-21', { sleepQuality: 5, energyWake: 2, anxiety: 1, waterL: 2.5, weightKg: 82.4 }),
          checkin('2026-10-20', { sleepQuality: 4, energyWake: 3, anxiety: 2, waterL: 3, weightKg: 82.8 }),
          checkin('2026-10-22', { sleepQuality: 4, energyWake: 3, anxiety: 2, waterL: 3.4, weightKg: null }),
          checkin('2026-10-10', { sleepQuality: 1 }), // before the cycle
        ],
      }),
      TODAY,
    )
    expect(s.sleep).toBe(4.3)
    expect(s.energyWake).toBe(2.7)
    expect(s.energyDay).toBe(4)
    expect(s.anxiety).toBe(1.7)
    expect(s.water).toBe(3)
    expect(s.waterTarget).toBe(3)
    expect(s.checkinCount).toBe(3)
    expect(s.weight).toEqual([{ date: '2026-10-20', kg: 82.8 }, { date: '2026-10-21', kg: 82.4 }])
  })

  it('averages ignore the fields of parts not saved; only days with both parts count as check-ins', () => {
    const morningOnly = { energyDay: null, anxiety: null, waterL: null, note: null }
    const eveningOnly = { sleepQuality: null, energyWake: null, bowel: null, weightKg: null }
    const cardioOnly = { ...morningOnly, ...eveningOnly, cardioDone: true, cardioMinutes: 30 }
    const s = buildSummary(
      input({
        checkins: [
          checkin('2026-10-20', { sleepQuality: 5, energyWake: 2, ...morningOnly }),
          checkin('2026-10-21', { energyDay: 2, anxiety: 4, waterL: 2, ...eveningOnly }),
          checkin('2026-10-22', { sleepQuality: 3, energyWake: 4, energyDay: 4, anxiety: 2, waterL: 3 }),
          checkin('2026-10-23', cardioOnly),
        ],
      }),
      TODAY,
    )
    expect(s.sleep).toBe(4)
    expect(s.energyWake).toBe(3)
    expect(s.energyDay).toBe(3)
    expect(s.anxiety).toBe(3)
    expect(s.water).toBe(2.5)
    expect(s.checkinCount).toBe(1)
    // Cardio still counts from the check-in (cardio-only row) as before.
    expect(s.calendar.find((d) => d.date === '2026-10-23')?.cardio).toBe(true)
  })

  it('has no averages without check-ins', () => {
    const s = buildSummary(input(), TODAY)
    expect([s.sleep, s.energyWake, s.energyDay, s.anxiety, s.water]).toEqual([null, null, null, null, null])
  })

  it('respects overrides and the plan version active on each day', () => {
    const later: WorkoutPlanAt = { planVersionId: 'p2', activatedOn: '2026-10-25', rotation: { type: 'fixed_weekdays', map: { mon: 'off', tue: 'off', wed: 'off', thu: 'off', fri: 'off', sat: 'off', sun: 'off' } } }
    const s = buildSummary(input({ plans: [plan, later], overrides: [{ date: '2026-10-21', dayKey: 'a' }] }), TODAY)
    // 20, 21 (override), 22, 23, 24 from the old version; nothing from the 25th on.
    expect(s.workouts.planned).toBe(5)
    expect(s.calendar.find((c) => c.date === '2026-10-26')?.planned).toBe(false)
    expect(s.calendar.find((c) => c.date === '2026-10-21')?.state).toBe('missed')
  })

  it('marks an overdue cycle and stops the stats at the update date', () => {
    const s = buildSummary(input(withSets('2026-10-20', '2026-12-01')), '2026-11-20')
    expect(s.cycle?.overdueDays).toBe(5)
    expect(s.cycle?.daysLeft).toBe(0)
    expect(s.workouts.done).toBe(1)
  })

  it('without an update date shows start..today', () => {
    const s = buildSummary(input({ protocol: { activatedOn: '2026-10-20', document: protocolDoc({ updateDate: null }) } }), TODAY)
    expect(s.cycle?.end).toBeNull()
    expect(s.calendar).toHaveLength(8)
  })

  it('before the cycle starts has nothing done or planned', () => {
    const s = buildSummary(input(), '2026-10-15')
    expect(s.workouts).toEqual({ done: 0, planned: 0 })
    expect(s.calendar.every((c) => c.state === 'future')).toBe(true)
  })

  it('without a protocol has no cycle', () => {
    const s = buildSummary(input({ protocol: null }), TODAY)
    expect(s.cycle).toBeNull()
    expect(s.calendar).toEqual([])
  })

  it('computes strength by group inside the cycle', () => {
    const ex: ExerciseLocal = { id: 'e1', name: 'Supino', normalizedName: 'supino', primaryMuscleGroup: 'chest', aliases: [] }
    const set = (sessionId: string, weightKg: number): SetLocal => ({
      id: `${sessionId}-1`, sessionId, exerciseId: 'e1', plannedExerciseKey: 'e1', setIndex: 0, weightKg, reps: 10, kind: 'normal',
      parentSetId: null, completedAt: '2026-10-20T12:30:00.000Z', clientUpdatedAt: '2026-10-20T12:30:00.000Z',
    })
    const s = buildSummary(
      input({ sessions: [session('2026-10-20'), session('2026-10-26')], sets: [set('s-2026-10-20', 60), set('s-2026-10-26', 70)], exercises: [ex] }),
      TODAY,
    )
    expect(s.strength?.chest.best[0].delta).toBeCloseTo(13.33, 1)
  })
})

describe('adherenceRates', () => {
  const log = (date: string, targetType: AdherenceLogLocal['targetType'], targetKey: string, status: AdherenceLogLocal['status']): AdherenceLogLocal => ({
    id: `${date}-${targetType}-${targetKey}`, date, targetType, targetKey, status, reason: null, note: null, clientUpdatedAt: `${date}T12:00:00.000Z`,
  })
  const document = protocolDoc({
    meals: [{ key: '1', label: 'REF 1', items: [] }, { key: '2', label: 'REF 2', items: [] }],
    items: [{ key: 'pre', category: 'supplement', name: 'Pré', timing: 'pre_workout', schedule: { type: 'training_days_only' } }],
  })
  const workoutPlans: DayWorkoutPlan[] = [{ ...plan, activatedAt: '2026-10-01T12:00:00.000Z' }]

  it('diet: 2 done + 1 partial of 4 planned is 62.5%, shown as "63%"; marks of unplanned targets do not count', () => {
    // Tue 20 and Wed 21: two meals each; the training-only item only on Tuesday (Wednesday is off).
    const rates = adherenceRates(
      {
        protocol: { activatedOn: '2026-10-20', document },
        workoutPlans,
        overrides: [],
        slots: [],
        adherence: [
          log('2026-10-20', 'meal', '1', 'done'),
          log('2026-10-20', 'meal', '2', 'partial'),
          log('2026-10-21', 'meal', '1', 'done'),
          log('2026-10-21', 'meal', '2', 'missed'),
          log('2026-10-21', 'meal', '9', 'done'),
          log('2026-10-21', 'protocol_item', 'pre', 'done'),
          log('2026-10-20', 'protocol_item', 'pre', 'partial'),
        ],
      },
      '2026-10-20',
      '2026-10-21',
      new Date(2026, 9, 25, 12), // both days are past: every planned target counts
    )
    expect(rates.diet).toEqual({ done: 2, partial: 1, planned: 4 })
    expect(formatRate(rates.diet)).toBe('63%')
    expect(rates.items).toEqual({ done: 0, partial: 1, planned: 1 })
    expect(formatRate(rates.items)).toBe('50%')
  })

  it('today only counts the marked targets and those whose time has come', () => {
    const slots = [
      { slot: 'meal_1', dayType: 'off' as const, time: '07:00', reminderEnabled: true },
      { slot: 'meal_2', dayType: 'off' as const, time: '12:00', reminderEnabled: true },
    ]
    const at = (h: number, m: number, adherence: AdherenceLogLocal[] = []) =>
      adherenceRates({ protocol: { activatedOn: '2026-10-20', document }, workoutPlans, overrides: [], adherence, slots }, '2026-10-21', '2026-10-21', new Date(2026, 9, 21, h, m))

    expect(at(6, 59).diet).toEqual({ done: 0, partial: 0, planned: 0 })
    expect(formatRate(at(6, 59).diet)).toBe('—')
    expect(at(7, 0).diet).toEqual({ done: 0, partial: 0, planned: 1 }) // REF 1 is due at 07:00
    expect(at(9, 0, [log('2026-10-21', 'meal', '2', 'done')]).diet).toEqual({ done: 1, partial: 0, planned: 2 }) // REF 2 marked early
    expect(at(12, 0).diet).toEqual({ done: 0, partial: 0, planned: 2 })

    // An untimed target counts today only once marked.
    const untimed = (adherence: AdherenceLogLocal[]) =>
      adherenceRates({ protocol: { activatedOn: '2026-10-20', document }, workoutPlans, overrides: [], adherence, slots: [] }, '2026-10-21', '2026-10-21', new Date(2026, 9, 21, 23, 0))
    expect(untimed([]).diet.planned).toBe(0)
    expect(untimed([log('2026-10-21', 'meal', '1', 'partial')]).diet).toEqual({ done: 0, partial: 1, planned: 1 })
  })

  it('nothing planned shows "—"', () => {
    expect(formatRate({ done: 0, partial: 0, planned: 0 })).toBe('—')
  })
})
