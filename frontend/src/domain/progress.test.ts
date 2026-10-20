import { describe, expect, it } from 'vitest'
import { addDays, dateRange } from './calendarDate'
import type { AdherenceTargetType, DayPlan, DayTarget } from './dayPlan'
import type { ProtocolDocument } from './planDocuments'
import {
  buildDayInfo,
  closedWeeks,
  cycleWorkouts,
  dayScore,
  EMPTY_SCORE,
  isOnTarget,
  medals,
  protocolOn,
  protocolSpans,
  streak,
  weekGoals,
  weekStart,
  type DayInfo,
  type DayScore,
  type Medal,
  type WeekGoal,
} from './progress'
import type { WorkoutPlanAt } from './rotation'
import type { TargetStatus } from './targetStatus'

// 2026-10-19 is a Monday; "today" is Thursday 2026-10-22 unless a test says otherwise.
const TODAY = '2026-10-22'

const target = (type: AdherenceTargetType, key: string, time: string | null = null): DayTarget => ({
  type, key, label: key, slot: time === null ? null : key, time, reminderEnabled: false,
})

const plan = (targets: DayTarget[], dayType: DayPlan['dayType'] = 'off'): DayPlan => ({ dayType, workoutDayKey: null, targets })
const statuses = (entries: Record<string, TargetStatus>) => new Map(Object.entries(entries))

const score = (done: number, planned: number, partial = 0): DayScore => ({ done, partial, planned, ratio: planned === 0 ? null : (done + partial / 2) / planned })
const ON = score(10, 10)
const OFF = score(5, 10)
const NONE = { ...EMPTY_SCORE }

const days = (from: string, scores: DayScore[]) => scores.map((s, i) => ({ date: addDays(from, i), score: s }))

describe('dayScore', () => {
  const targets = [
    target('meal', '1', '08:00'),
    target('meal', '2', '12:00'),
    target('protocol_item', 'creatina'),
    target('checkin', 'checkin_morning', '07:00'),
    target('checkin', 'checkin_evening', '21:30'),
  ]

  it('a closed day counts every target: done 1, partial ½', () => {
    expect(dayScore(plan(targets), statuses({ 'meal:1': 'done', 'meal:2': 'partial', 'checkin:checkin_morning': 'done' }), { isToday: false }))
      .toEqual({ done: 2, partial: 1, planned: 5, ratio: 0.5 })
  })

  it('today counts only targets already due or marked', () => {
    const now = new Date(2026, 9, 22, 10, 0)
    // Due: meal 1 (08:00), morning check-in (07:00). Not yet: meal 2 (12:00), untimed item, evening check-in.
    expect(dayScore(plan(targets), statuses({}), { isToday: true, now })).toEqual({ done: 0, partial: 0, planned: 2, ratio: 0 })
    // Marked ones count even before their time (or without one).
    expect(dayScore(plan(targets), statuses({ 'meal:2': 'done', 'protocol_item:creatina': 'missed', 'checkin:checkin_morning': 'done' }), { isToday: true, now }))
      .toEqual({ done: 2, partial: 0, planned: 4, ratio: 0.5 })
    // At 10:00 sharp a 10:00 target is due.
    expect(dayScore(plan([target('meal', '1', '10:00')]), statuses({}), { isToday: true, now }).planned).toBe(1)
  })

  it('a day with neither protocol nor workout plan has nothing planned (its check-ins alone do not count)', () => {
    const onlyCheckins = plan([target('checkin', 'checkin_morning'), target('checkin', 'checkin_evening')], 'none')
    expect(dayScore(onlyCheckins, statuses({ 'checkin:checkin_morning': 'done' }), { isToday: false })).toEqual({ done: 0, partial: 0, planned: 0, ratio: null })
    // A rest day of a workout plan still counts them.
    expect(dayScore(plan(onlyCheckins.targets, 'off'), statuses({ 'checkin:checkin_morning': 'done' }), { isToday: false }).planned).toBe(2)
  })

  it('optional cardio (N sessions a week) counts only when marked', () => {
    const p = plan([target('meal', '1'), target('cardio', 'cardio')])
    expect(dayScore(p, statuses({ 'meal:1': 'done' }), { isToday: false, cardioOptional: true })).toMatchObject({ done: 1, planned: 1 })
    expect(dayScore(p, statuses({ 'meal:1': 'done', 'cardio:cardio': 'missed' }), { isToday: false, cardioOptional: true })).toMatchObject({ done: 1, planned: 2 })
    expect(dayScore(p, statuses({ 'meal:1': 'done' }), { isToday: false })).toMatchObject({ done: 1, planned: 2 })
  })
})

describe('isOnTarget', () => {
  it('needs 90 % with something planned', () => {
    expect(isOnTarget(score(9, 10))).toBe(true)
    expect(isOnTarget(score(17, 20, 2))).toBe(true) // 18 of 20
    expect(isOnTarget(score(8, 10, 1))).toBe(false) // 85 %
    expect(isOnTarget(NONE)).toBe(false)
  })
})

describe('streak', () => {
  it('counts the days on target ending yesterday; today joins only once it reaches 90 %', () => {
    const week = days('2026-10-15', [ON, ON, ON, ON, ON, ON, ON])
    expect(streak([...week, { date: TODAY, score: score(8, 10) }], TODAY)).toEqual({ current: 7, best: 7 })
    expect(streak([...week, { date: TODAY, score: score(9, 10) }], TODAY)).toEqual({ current: 8, best: 8 })
    // No row for today yet: same as below target.
    expect(streak(week, TODAY)).toEqual({ current: 7, best: 7 })
  })

  it('one day below 90 % breaks it', () => {
    const d = days('2026-10-15', [ON, ON, ON, OFF, ON, ON, ON])
    expect(streak(d, TODAY)).toEqual({ current: 3, best: 3 })
    // Yesterday below 90 %: zero until today reaches the target.
    const yesterdayLow = days('2026-10-15', [ON, ON, ON, ON, ON, ON, score(8, 10)])
    expect(streak([...yesterdayLow, { date: TODAY, score: score(1, 3) }], TODAY)).toEqual({ current: 0, best: 6 })
    expect(streak([...yesterdayLow, { date: TODAY, score: score(3, 3) }], TODAY)).toEqual({ current: 1, best: 6 })
  })

  it('a day with nothing planned neither counts nor breaks', () => {
    const d = days('2026-10-17', [ON, ON, NONE, ON, ON])
    expect(streak(d, TODAY)).toEqual({ current: 4, best: 4 })
    expect(streak(days('2026-10-20', [NONE, NONE]), TODAY)).toEqual({ current: 0, best: 0 })
  })

  it('a missing day breaks it, and so does a gap before today', () => {
    const d = [...days('2026-10-16', [ON, ON, ON]), ...days('2026-10-20', [ON, ON])] // no 2026-10-19
    expect(streak(d, TODAY)).toEqual({ current: 2, best: 3 })
    expect(streak(days('2026-10-15', [ON, ON, ON, ON, ON]), TODAY)).toEqual({ current: 0, best: 5 }) // last day 10-19
  })

  it('ignores days after today', () => {
    expect(streak(days('2026-10-20', [ON, ON, ON, ON]), TODAY)).toEqual({ current: 3, best: 3 })
  })
})

const info = (date: string, over: Partial<DayInfo> = {}): DayInfo => ({
  date,
  when: date < TODAY ? 'past' : date === TODAY ? 'today' : 'future',
  dayType: 'off',
  score: date > TODAY ? NONE : ON,
  diet: { done: 0, partial: 0, planned: 0 },
  items: { done: 0, partial: 0, planned: 0 },
  dietComplete: null,
  workout: { planned: false, done: false },
  cardio: { planned: false, done: false },
  checkin: { morning: false, evening: false },
  waterL: null,
  ...over,
})

const MONDAY = '2026-10-19'
const weekOf = (fn: (date: string, i: number) => Partial<DayInfo> = () => ({})) =>
  dateRange(MONDAY, addDays(MONDAY, 6)).map((d, i) => info(d, fn(d, i)))

const proto = (over: Partial<ProtocolDocument> = {}): ProtocolDocument => ({ meals: [], items: [], guidelines: [], ...over })
const goal = (goals: WeekGoal[], key: WeekGoal['key']) => goals.find((g) => g.key === key)

describe('weekStart', () => {
  it('is the Monday of the week', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(weekStart('2026-10-22')).toBe('2026-10-19')
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
  })
})

describe('weekGoals', () => {
  it('water: days at or above water_min_l, target 5; left out without the guideline', () => {
    const water = [3, 2.5, 3.5, null]
    const week = weekOf((_, i) => ({ waterL: water[i] ?? null }))
    const withWater = proto({ guidelines: [{ kind: 'water_min_l', value: 3 }] })
    expect(goal(weekGoals(week, withWater), 'water')).toEqual({ key: 'water', label: 'Água na meta em 5 dias', unit: 'count', progress: 2, target: 5, done: false })

    const five = dateRange('2026-10-12', '2026-10-18').map((d, i) => ({ ...info(d), waterL: i < 5 ? 3 : 1 }))
    expect(goal(weekGoals(five, withWater), 'water')).toMatchObject({ progress: 5, done: true })

    expect(goal(weekGoals(week, proto()), 'water')).toBeUndefined()
    expect(goal(weekGoals(week, proto({ guidelines: [{ kind: 'text', text: 'Beber água' }] })), 'water')).toBeUndefined()
    expect(goal(weekGoals(week, null), 'water')).toBeUndefined()
  })

  it('workouts: planned days done so far of all planned days of the week (future ones included)', () => {
    // Mon/Wed/Fri planned; Mon and Wed done, Fri is in the future.
    const week = weekOf((_, i) => ({ workout: { planned: i % 2 === 0 && i < 5, done: i === 0 || i === 2 } }))
    expect(goal(weekGoals(week, proto()), 'workouts')).toEqual({ key: 'workouts', label: 'Todos os treinos', unit: 'count', progress: 2, target: 3, done: false })
    // A closed week with all of them done.
    const closed = dateRange('2026-10-12', '2026-10-18').map((d, i) => info(d, { workout: { planned: i % 2 === 0 && i < 5, done: i % 2 === 0 } }))
    expect(goal(weekGoals(closed, proto()), 'workouts')).toMatchObject({ progress: 3, target: 3, done: true })
    expect(goal(weekGoals(weekOf(), proto()), 'workouts')).toBeUndefined()
  })

  it('cardio: sessionsPerWeek (or every listed day when daily); left out when none is planned', () => {
    const week = weekOf((_, i) => ({ cardio: { planned: true, done: i < 3 } }))
    expect(goal(weekGoals(week, proto({ cardio: { sessionsPerWeek: 3 } })), 'cardio')).toEqual({ key: 'cardio', label: 'Cardio previsto', unit: 'count', progress: 3, target: 3, done: true })
    expect(goal(weekGoals(week, proto({ cardio: { daily: true } })), 'cardio')).toMatchObject({ progress: 3, target: 7, done: false })
    expect(goal(weekGoals(weekOf(), proto()), 'cardio')).toBeUndefined()
  })

  it('diet and items: the rate of the days so far ≥ 90 %; future days only tell whether anything is planned', () => {
    const week = weekOf((d, i) => ({
      diet: d > TODAY ? { done: 0, partial: 0, planned: 5 } : { done: 5, partial: 0, planned: 5 },
      items: i < 4 ? { done: 1, partial: 1, planned: 2 } : { done: 0, partial: 0, planned: 2 },
    }))
    const goals = weekGoals(week, proto())
    expect(goal(goals, 'diet')).toEqual({ key: 'diet', label: 'Dieta ≥ 90%', unit: 'percent', progress: 100, target: 90, done: true })
    expect(goal(goals, 'items')).toEqual({ key: 'items', label: 'Itens do protocolo ≥ 90%', unit: 'percent', progress: 75, target: 90, done: false })
    // Nothing planned yet this week (Monday early) but meals later: 0 %, not done.
    const early = weekOf((d) => ({ when: d === MONDAY ? 'today' : 'future', diet: { done: 0, partial: 0, planned: d === MONDAY ? 0 : 5 } }))
    expect(goal(weekGoals(early, proto()), 'diet')).toMatchObject({ progress: 0, done: false })
    expect(goal(weekGoals(weekOf(), proto()), 'diet')).toBeUndefined()
  })

  it('check-ins: the target is the days of the week inside the history when it starts mid-week', () => {
    const week = weekOf(() => ({ checkin: { morning: true, evening: true } }))
    expect(goal(weekGoals(week, null, { historyStart: '2026-10-21' }), 'checkins')).toMatchObject({ progress: 2, target: 5, done: false })
    expect(goal(weekGoals(week, null, { historyStart: '2026-10-01' }), 'checkins')).toMatchObject({ progress: 4, target: 7 })
    expect(goal(weekGoals(week, null, { historyStart: '2026-10-25' }), 'checkins')).toMatchObject({ progress: 0, target: 1 })
  })

  it('check-ins: days with both parts, target 7; goals come in a fixed order', () => {
    const week = weekOf((_, i) => ({ checkin: { morning: true, evening: i !== 1 } }))
    const goals = weekGoals(week, proto({ guidelines: [{ kind: 'water_min_l', value: 2 }], cardio: { daily: true } }))
    expect(goal(goals, 'checkins')).toEqual({ key: 'checkins', label: 'Check-ins completos', unit: 'count', progress: 3, target: 7, done: false })
    expect(goals.map((g) => g.key)).toEqual(['water', 'checkins']) // no meals, items, workouts or listed cardio days
  })
})

describe('buildDayInfo', () => {
  const p = plan([target('meal', '1', '08:00'), target('meal', '2', '20:00'), target('workout', 'workout'), target('cardio', 'cardio'), target('checkin', 'checkin_morning')], 'training')
  const base = { plan: p, checkinParts: { morning: true, evening: false }, waterL: 2.5, cardioOptional: false }

  it('a past day: rates, complete diet, workout and cardio from the statuses or the check-in', () => {
    const d = buildDayInfo({ ...base, date: '2026-10-20', when: 'past', statuses: statuses({ 'meal:1': 'done', 'meal:2': 'done', 'workout:workout': 'done', 'cardio:cardio': 'done' }) })
    expect(d).toMatchObject({
      diet: { done: 2, partial: 0, planned: 2 }, dietComplete: true, workout: { planned: true, done: true },
      cardio: { planned: true, done: true }, checkin: { morning: true, evening: false }, waterL: 2.5,
    })
    expect(d.score).toMatchObject({ done: 4, planned: 5 })
  })

  it('today: due-or-marked rates; a future day has nothing done and an empty score', () => {
    const now = new Date(2026, 9, 22, 12, 0)
    const today = buildDayInfo({ ...base, date: TODAY, when: 'today', statuses: statuses({ 'meal:1': 'done' }) }, now)
    expect(today.diet).toEqual({ done: 1, partial: 0, planned: 1 })
    expect(today.dietComplete).toBe(false)
    const future = buildDayInfo({ ...base, date: '2026-10-23', when: 'future', statuses: statuses({ 'meal:1': 'done' }) }, now)
    expect(future).toMatchObject({ score: NONE, diet: { done: 0, planned: 2 }, dietComplete: false, workout: { planned: true, done: false }, checkin: { morning: false, evening: false }, waterL: null })
  })
})

describe('protocol spans and cycles', () => {
  const doc = (updateDate?: string) => proto(updateDate ? { updateDate } : {})

  it('a cycle ends at its update date or the day before the next activation, whichever comes first', () => {
    const spans = protocolSpans([
      { activatedOn: '2026-10-11', activatedAt: '2026-10-11T12:00:00Z', document: doc() },
      { activatedOn: '2026-09-01', activatedAt: '2026-09-01T12:00:00Z', document: doc('2026-10-20') },
      { activatedOn: '2026-08-01', activatedAt: '2026-08-01T12:00:00Z', document: doc('2026-08-30') },
    ])
    expect(spans.map((s) => [s.activatedOn, s.end])).toEqual([
      ['2026-08-01', '2026-08-30'],
      ['2026-09-01', '2026-10-10'],
      ['2026-10-11', null],
    ])
    expect(protocolOn('2026-08-31', spans)?.activatedOn).toBe('2026-08-01')
    expect(protocolOn('2026-10-11', spans)?.activatedOn).toBe('2026-10-11')
    expect(protocolOn('2026-07-31', spans)).toBeNull()
  })

  it('counts planned and done workouts of closed cycles and of the one in force', () => {
    const spans = protocolSpans([
      { activatedOn: '2026-10-01', activatedAt: '2026-10-01T12:00:00Z', document: doc('2026-10-10') },
      { activatedOn: '2026-10-11', activatedAt: '2026-10-11T12:00:00Z', document: doc('2026-10-31') },
    ])
    const plans: WorkoutPlanAt[] = [{ planVersionId: 'w1', activatedOn: '2026-10-01', rotation: { type: 'sequence', items: ['a', 'off'] } }]
    // Planned: 10-01, 03, 05, 07, 09 | 10-11, 13, … 31 (11 days).
    const worked = new Set(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11', '2026-10-13', '2026-10-15'])
    expect(cycleWorkouts(spans, TODAY, '2026-10-01', plans, [], worked)).toEqual([
      { start: '2026-10-01', end: '2026-10-10', planned: 5, done: 5, closed: true },
      { start: '2026-10-11', end: '2026-10-31', planned: 11, done: 3, closed: false },
    ])
    // A cycle that began before the history is left out unless it is the open one in force (then counted from the history start).
    expect(cycleWorkouts(spans, TODAY, '2026-10-12', plans, [], worked)).toEqual([
      { start: '2026-10-11', end: '2026-10-31', planned: 10, done: 2, closed: false },
    ])
    // Overdue (closed) and begun before the history: left out, so partial data cannot earn the medal.
    expect(cycleWorkouts(spans, '2026-11-05', '2026-10-12', plans, [], worked)).toEqual([])
  })
})

const medal = (list: Medal[], key: Medal['key']) => list.find((m) => m.key === key)!

describe('medals', () => {
  const none = { weeks: [], cycles: [], currentWeek: [] }

  it('streak medals: earned on the day the run got there; locked ones show the current run', () => {
    // 10 days on target, 10-12 … 10-21; today not yet.
    const history = dateRange('2026-10-12', TODAY).map((d) => info(d, { score: d === TODAY ? score(1, 4) : ON }))
    const list = medals(history, TODAY, none)
    expect(medal(list, 'streak_7')).toEqual({ key: 'streak_7', label: 'Sequência de 7 dias', earnedOn: '2026-10-18', count: 1, progress: { value: 7, target: 7 } })
    expect(medal(list, 'streak_14')).toEqual({ key: 'streak_14', label: 'Sequência de 14 dias', earnedOn: null, count: 0, progress: { value: 10, target: 14 } })
    expect(medal(list, 'streak_30')).toMatchObject({ earnedOn: null, progress: { value: 10, target: 30 } })
  })

  it('a broken run earns again when it reaches the target again; earnedOn is the latest', () => {
    const scores = [...Array(7).fill(ON), OFF, ...Array(7).fill(ON)] as DayScore[]
    const history = scores.map((s, i) => info(addDays('2026-10-01', i), { score: s }))
    expect(medal(medals(history, '2026-10-16', none), 'streak_7')).toMatchObject({ earnedOn: '2026-10-15', count: 2 })
  })

  it('diet 100 % for 7 days: days without meals are skipped; an incomplete day breaks it', () => {
    const complete = dateRange('2026-10-13', '2026-10-21').map((d) => info(d, { dietComplete: d === '2026-10-16' ? null : true }))
    expect(medal(medals(complete, TODAY, none), 'diet_100_7')).toMatchObject({ label: 'Dieta 100% por 7 dias', earnedOn: '2026-10-20', count: 1, progress: { value: 7, target: 7 } })
    const broken = complete.map((d) => (d.date === '2026-10-18' ? { ...d, dietComplete: false } : d))
    expect(medal(medals(broken, TODAY, none), 'diet_100_7')).toMatchObject({ earnedOn: null, progress: { value: 3, target: 7 } })
  })

  it('perfect week: closed weeks with every goal done, earned on the Sunday; progress is this week', () => {
    // History from Monday 10-05: two full closed weeks with complete check-ins (the only goal without a plan), then this week.
    const full = { checkin: { morning: true, evening: true } }
    const history = dateRange('2026-10-05', TODAY).map((d) => info(d, d === '2026-10-14' ? {} : full))
    const weeks = closedWeeks(history, [], TODAY)
    expect(weeks.map((w) => [w.start, w.end, w.perfect])).toEqual([
      ['2026-10-05', '2026-10-11', true],
      ['2026-10-12', '2026-10-18', false],
    ])
    const currentWeek = weekGoals(history.filter((d) => d.date >= MONDAY), null)
    const m = medal(medals(history, TODAY, { weeks, cycles: [], currentWeek }), 'perfect_week')
    expect(m).toEqual({ key: 'perfect_week', label: 'Semana perfeita', earnedOn: '2026-10-11', count: 1, progress: { value: 0, target: 1 } })
  })

  it('a week cut by the start of the history is not judged', () => {
    const history = dateRange('2026-10-07', TODAY).map((d) => info(d, { checkin: { morning: true, evening: true } }))
    expect(closedWeeks(history, [], TODAY).map((w) => w.start)).toEqual(['2026-10-12'])
  })

  it('all workouts of the cycle: earned when a closed cycle had them all; progress is the cycle in force', () => {
    const cycles = [
      { start: '2026-09-01', end: '2026-09-30', planned: 12, done: 12, closed: true },
      { start: '2026-10-01', end: '2026-10-31', planned: 13, done: 6, closed: false },
    ]
    expect(medal(medals([], TODAY, { ...none, cycles }), 'all_workouts_cycle')).toEqual({
      key: 'all_workouts_cycle', label: 'Todos os treinos do ciclo', earnedOn: '2026-09-30', count: 1, progress: { value: 6, target: 13 },
    })
    const missedOne = [{ ...cycles[0]!, done: 11 }, cycles[1]!]
    expect(medal(medals([], TODAY, { ...none, cycles: missedOne }), 'all_workouts_cycle')).toMatchObject({ earnedOn: null, count: 0 })
    // A closed cycle without planned workouts earns nothing.
    expect(medal(medals([], TODAY, { ...none, cycles: [{ ...cycles[0]!, planned: 0, done: 0 }] }), 'all_workouts_cycle')).toMatchObject({ earnedOn: null, progress: { value: 0, target: 0 } })
  })

  it('lists every medal in a fixed order', () => {
    expect(medals([], TODAY, none).map((m) => m.key)).toEqual(['perfect_week', 'diet_100_7', 'streak_7', 'streak_14', 'streak_30', 'all_workouts_cycle'])
  })
})
