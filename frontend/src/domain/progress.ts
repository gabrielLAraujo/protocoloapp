import { addDays, dateRange, diffDays, weekdayOf, type Weekday } from './calendarDate'
import type { DayKind, DayPlan } from './dayPlan'
import type { ProtocolDocument } from './planDocuments'
import { plannedWorkoutDays, type RotationOverrideAt, type WorkoutPlanAt } from './rotation'
import { clockOf, countsAsPlanned, targetId, type TargetStatus } from './targetStatus'

/**
 * Gamification (spec "Pontuação do dia", "Meta do dia", "Sequência", "Metas da semana", "Medalhas"): pure functions
 * over the days built by `buildDay` and their marks. Dates are yyyy-MM-dd; nothing here reads a clock unless given one.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Day score

export interface DayScore {
  done: number
  partial: number
  /** Targets that count: every one on a closed day; today only the marked ones and those whose time has come. */
  planned: number
  /** (done + 0.5 × partial) / planned; null when planned = 0. */
  ratio: number | null
}

/** The status of each target of a day by `targetId` (`type:key`): the mark, or the derived one (session, check-in part). */
export type TargetStatuses = ReadonlyMap<string, TargetStatus | null>

export interface DayScoreOptions {
  /** Today counts only what is marked or already due (by `now`, default the device clock). */
  isToday: boolean
  now?: Date
  /**
   * The protocol asks for N cardio sessions a week (not daily): buildDay lists cardio every day, but any day may be a
   * rest from it, so an unmarked cardio does not count. A cardio marked partial/missed still counts.
   */
  cardioOptional?: boolean
  /**
   * Diet deviations recorded on the day (something eaten outside the plan): each counts as one more planned diet target
   * that was not done, so the diet is done ÷ (planned + deviations). They count as soon as they are recorded (no time).
   */
  deviations?: number
}

export const EMPTY_SCORE: DayScore = Object.freeze({ done: 0, partial: 0, planned: 0, ratio: null }) as DayScore

/** A day with neither a protocol nor a workout plan has nothing planned: its check-in targets alone do not count. */
const hasPlan = (plan: DayPlan) => plan.dayType !== 'none' || plan.targets.some((t) => t.type !== 'checkin')

/** Score of a day over all its targets: meals, protocol items, cardio, workout and both check-in parts. */
export function dayScore(plan: DayPlan, statuses: TargetStatuses, opts: DayScoreOptions): DayScore {
  if (!hasPlan(plan)) return { ...EMPTY_SCORE }
  const clock = opts.isToday ? clockOf(opts.now ?? new Date()) : null
  let done = 0
  let partial = 0
  let planned = 0
  for (const t of plan.targets) {
    const status = statuses.get(targetId(t)) ?? null
    if (t.type === 'cardio' && opts.cardioOptional && status === null) continue
    if (!countsAsPlanned(t, status, clock)) continue
    planned++
    if (status === 'done') done++
    else if (status === 'partial') partial++
  }
  planned += Math.max(0, opts.deviations ?? 0)
  return { done, partial, planned, ratio: planned === 0 ? null : (done + 0.5 * partial) / planned }
}

/** Day "na meta": score ≥ 90 % with something planned (integer comparison, so 9 of 10 is exactly on target). */
export const isOnTarget = (score: DayScore): boolean => score.planned > 0 && (2 * score.done + score.partial) * 10 >= 18 * score.planned

// ---------------------------------------------------------------------------------------------------------------------
// Day info (what the week goals and medals read)

export interface TargetRate {
  done: number
  partial: number
  planned: number
}

export type DayWhen = 'past' | 'today' | 'future'

export interface DayInfo {
  date: string
  when: DayWhen
  dayType: DayKind
  /** Future days: EMPTY_SCORE. */
  score: DayScore
  /**
   * Meals (and protocol items): today only due-or-marked; on a future day `planned` is the whole day and nothing is done.
   * The diet's `planned` also counts the day's deviations (done ÷ (planned meals + deviations)).
   */
  diet: TargetRate
  items: TargetRate
  /** Every meal of the whole day done and no deviation; null when the day has neither meals nor deviations. False on future days. */
  dietComplete: boolean | null
  workout: { planned: boolean; done: boolean }
  /** `planned`: the day lists cardio. `done`: its status is done (marked, or "cardio feito" on the check-in without a mark). */
  cardio: { planned: boolean; done: boolean }
  /** Saved check-in parts (false on future days). */
  checkin: { morning: boolean; evening: boolean }
  /** Water of the evening check-in, null when not answered. */
  waterL: number | null
}

export interface DayInfoInput {
  date: string
  when: DayWhen
  plan: DayPlan
  statuses: TargetStatuses
  checkinParts: { morning: boolean; evening: boolean }
  waterL: number | null
  cardioOptional: boolean
  /** Diet deviations recorded on the day (see DayScoreOptions.deviations). */
  deviations?: number
}

/** Pure: everything the gamification needs about one day. `now` is the clock for today's due targets. */
export function buildDayInfo(input: DayInfoInput, now: Date = new Date()): DayInfo {
  const { plan, statuses, when } = input
  const future = when === 'future'
  const clock = when === 'today' ? clockOf(now) : null
  const statusOf = (id: string) => (future ? null : (statuses.get(id) ?? null))
  const rate = (type: 'meal' | 'protocol_item'): TargetRate => {
    const r: TargetRate = { done: 0, partial: 0, planned: 0 }
    for (const t of plan.targets) {
      if (t.type !== type) continue
      const status = statusOf(targetId(t))
      if (!future && !countsAsPlanned(t, status, clock)) continue
      r.planned++
      if (status === 'done') r.done++
      else if (status === 'partial') r.partial++
    }
    return r
  }
  // Like dayScore: without any plan (no protocol, no workout plan) there is no diet to deviate from.
  const deviations = future || !hasPlan(plan) ? 0 : Math.max(0, input.deviations ?? 0)
  const diet = rate('meal')
  diet.planned += deviations
  const meals = plan.targets.filter((t) => t.type === 'meal')
  const workout = plan.targets.find((t) => t.type === 'workout')
  const cardio = plan.targets.find((t) => t.type === 'cardio')
  return {
    date: input.date,
    when,
    dayType: plan.dayType,
    score: future
      ? { ...EMPTY_SCORE }
      : dayScore(plan, statuses, { isToday: when === 'today', now, cardioOptional: input.cardioOptional, deviations }),
    diet,
    items: rate('protocol_item'),
    dietComplete:
      meals.length === 0 && deviations === 0 ? null : !future && deviations === 0 && meals.every((m) => statusOf(targetId(m)) === 'done'),
    workout: { planned: workout !== undefined, done: workout !== undefined && statusOf(targetId(workout)) === 'done' },
    cardio: {
      planned: cardio !== undefined,
      done: cardio !== undefined && statusOf(targetId(cardio)) === 'done',
    },
    checkin: future ? { morning: false, evening: false } : { ...input.checkinParts },
    waterL: future ? null : input.waterL,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs (streak and medals)

type RunState = 'hit' | 'miss' | 'skip'

interface RunResult {
  /** The run ending yesterday, plus today when today is a hit (0 when a day before is missing). */
  current: number
  best: number
  /** Dates on which a run reached `threshold` (one per run). */
  reached: string[]
}

/**
 * Walks days in date order: a hit extends the run, a miss ends it, a skip neither counts nor breaks. A date missing
 * between two days (no data) ends the run. Today never breaks it: a miss today only means "not yet".
 */
function walkRuns(days: readonly { date: string; state: RunState }[], today: string, threshold = 0): RunResult {
  const sorted = days.filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let run = 0
  let best = 0
  let prev: string | null = null
  const reached: string[] = []
  for (const d of sorted) {
    if (prev !== null && diffDays(prev, d.date) > 1) run = 0
    prev = d.date
    if (d.state === 'skip') continue
    if (d.state === 'hit') {
      run++
      best = Math.max(best, run)
      if (threshold > 0 && run === threshold) reached.push(d.date)
    } else if (d.date !== today) {
      run = 0
    }
  }
  // The last known day is before yesterday: the days between have no data, so the run is over.
  const current = prev !== null && diffDays(prev, today) > 1 ? 0 : run
  return { current, best, reached }
}

export interface Streak {
  /** Consecutive days on target ending yesterday, plus today once today reaches 90 %. */
  current: number
  best: number
}

const scoreState = (score: DayScore): RunState => (score.planned === 0 ? 'skip' : isOnTarget(score) ? 'hit' : 'miss')

/**
 * Days on target in a row. Days with nothing planned neither count nor break; a day below 90 % breaks (today only
 * joins once it is on target and never breaks); a missing date between the given days breaks.
 */
export function streak(days: readonly { date: string; score: DayScore }[], today: string): Streak {
  const { current, best } = walkRuns(
    days.map((d) => ({ date: d.date, state: scoreState(d.score) })),
    today,
  )
  return { current, best }
}

// ---------------------------------------------------------------------------------------------------------------------
// Week goals

const WEEK_INDEX: Record<Weekday, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }

/** Monday of the Monday–Sunday week of `date`. */
export const weekStart = (date: string): string => addDays(date, -WEEK_INDEX[weekdayOf(date)])

export type WeekGoalKey = 'diet' | 'items' | 'workouts' | 'cardio' | 'water' | 'checkins'

export interface WeekGoal {
  key: WeekGoalKey
  /** pt-BR. */
  label: string
  /** `percent` goals (diet, items): progress is the rounded % so far and target 90. `count`: days or sessions. */
  unit: 'percent' | 'count'
  progress: number
  target: number
  done: boolean
}

export const WATER_DAYS_TARGET = 5
export const CHECKIN_DAYS_TARGET = 7
const RATE_TARGET = 90

/** The protocol's minimum water a day (L), or null without that guideline. */
export function waterMinL(protocol: ProtocolDocument | null | undefined): number | null {
  const g = protocol?.guidelines.find((x) => x.kind === 'water_min_l' && typeof x.value === 'number' && x.value > 0)
  return g?.value ?? null
}

/**
 * The goals of a Monday–Sunday week (`week`: its days, future ones included). Rules:
 * - diet / items: (done + 0.5 × partial) / planned over the days up to today (today: due-or-marked) ≥ 90 %. Left out
 *   when nothing of the kind is planned in the whole week.
 * - workouts: planned training days done (up to today) of all planned training days of the week, future ones included.
 * - cardio: days with cardio done of the planned sessions: every day listing cardio for a daily protocol, else
 *   `sessionsPerWeek` (at most the days listing it). Left out when none is planned.
 * - water: days with `waterL ≥ water_min_l`, target 5. Left out without the guideline.
 * - checkins: days with both parts saved, target 7 (fewer when `historyStart` falls inside the week: the days from it).
 * A `count` goal is done once progress reaches the target (progress may pass it).
 */
export function weekGoals(week: readonly DayInfo[], protocol: ProtocolDocument | null, opts: { historyStart?: string } = {}): WeekGoal[] {
  const elapsed = week.filter((d) => d.when !== 'future')
  const goals: WeekGoal[] = []

  const rateGoal = (key: 'diet' | 'items', label: string, pick: (d: DayInfo) => TargetRate) => {
    if (!week.some((d) => pick(d).planned > 0)) return
    const sum = elapsed.reduce((acc, d) => {
      const r = pick(d)
      return { done: acc.done + r.done, partial: acc.partial + r.partial, planned: acc.planned + r.planned }
    }, { done: 0, partial: 0, planned: 0 })
    const points = 2 * sum.done + sum.partial // half points
    goals.push({
      key,
      label,
      unit: 'percent',
      progress: sum.planned === 0 ? 0 : Math.round((points * 50) / sum.planned),
      target: RATE_TARGET,
      done: sum.planned > 0 && points * 10 >= 18 * sum.planned,
    })
  }
  const countGoal = (key: WeekGoalKey, label: string, progress: number, target: number) =>
    goals.push({ key, label, unit: 'count', progress, target, done: progress >= target })

  rateGoal('diet', 'Dieta ≥ 90%', (d) => d.diet)
  rateGoal('items', 'Itens do protocolo ≥ 90%', (d) => d.items)

  const workoutsPlanned = week.filter((d) => d.workout.planned).length
  if (workoutsPlanned > 0) countGoal('workouts', 'Todos os treinos', elapsed.filter((d) => d.workout.planned && d.workout.done).length, workoutsPlanned)

  const cardioDays = week.filter((d) => d.cardio.planned).length
  const perWeek = protocol?.cardio?.daily === true ? cardioDays : Math.min(protocol?.cardio?.sessionsPerWeek ?? 0, cardioDays)
  if (perWeek > 0) countGoal('cardio', 'Cardio previsto', elapsed.filter((d) => d.cardio.done).length, perWeek)

  const water = waterMinL(protocol)
  if (water !== null) {
    countGoal('water', 'Água na meta em 5 dias', elapsed.filter((d) => d.waterL !== null && d.waterL >= water).length, WATER_DAYS_TARGET)
  }

  const start = opts.historyStart
  const checkinDays = start === undefined ? CHECKIN_DAYS_TARGET : Math.min(CHECKIN_DAYS_TARGET, Math.max(1, week.filter((d) => d.date >= start).length))
  const checkinsDone = elapsed.filter((d) => (start === undefined || d.date >= start) && d.checkin.morning && d.checkin.evening).length
  countGoal('checkins', 'Check-ins completos', checkinsDone, checkinDays)
  return goals
}

// ---------------------------------------------------------------------------------------------------------------------
// Protocol cycles

/** A protocol version as it was active: from `activatedOn` until the next activation. */
export interface ProtocolSpan {
  activatedOn: string
  /** ISO instant (orders same-day activations). */
  activatedAt: string
  /** Last day of the cycle: the update date, or the day before the next activation if that comes first; null when open. */
  end: string | null
  document: ProtocolDocument
}

/** Spans of the protocol versions that were activated (any order in, oldest activation first out). */
export function protocolSpans(versions: readonly { activatedOn: string; activatedAt: string; document: ProtocolDocument }[]): ProtocolSpan[] {
  const sorted = [...versions].sort((a, b) => Date.parse(a.activatedAt) - Date.parse(b.activatedAt))
  return sorted.map((v, i) => {
    const next = sorted[i + 1]
    const beforeNext = next ? addDays(next.activatedOn, -1) : null
    const update = v.document.updateDate ?? null
    const end = update !== null && beforeNext !== null ? (update < beforeNext ? update : beforeNext) : (update ?? beforeNext)
    return { activatedOn: v.activatedOn, activatedAt: v.activatedAt, end, document: v.document }
  })
}

/** The protocol version in force on `date` (the latest activated on or before it), or null. */
export function protocolOn(date: string, spans: readonly ProtocolSpan[]): ProtocolSpan | null {
  let found: ProtocolSpan | null = null
  for (const s of spans) if (s.activatedOn <= date) found = s
  return found
}

export interface CycleWorkouts {
  start: string
  end: string | null
  /** Planned training days of the cycle: through `end`, or through today while it has no end. */
  planned: number
  /** Planned training days done up to today. */
  done: number
  /** `end` has passed. */
  closed: boolean
}

/**
 * Workouts of each protocol cycle that starts on or after `historyStart` (earlier ones cannot be checked), plus the
 * open cycle in force today in any case (from `historyStart` when it began before). A closed cycle that began before
 * `historyStart` is left out (it could earn the medal on partial data), and so is a span replaced on its own first day.
 */
export function cycleWorkouts(
  spans: readonly ProtocolSpan[],
  today: string,
  historyStart: string,
  plans: WorkoutPlanAt[],
  overrides: RotationOverrideAt[],
  workedOut: ReadonlySet<string>,
): CycleWorkouts[] {
  const current = protocolOn(today, spans)
  const out: CycleWorkouts[] = []
  for (const s of spans) {
    if (s.end !== null && s.end < s.activatedOn) continue
    const closed = s.end !== null && s.end < today
    if (s.activatedOn < historyStart && (s !== current || closed)) continue
    if (s.activatedOn > today) continue
    const start = s.activatedOn < historyStart ? historyStart : s.activatedOn
    const planned = plannedWorkoutDays(start, s.end ?? today, plans, overrides)
    out.push({
      start: s.activatedOn,
      end: s.end,
      planned: planned.length,
      done: planned.filter((d) => d <= today && workedOut.has(d)).length,
      closed,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Closed weeks and medals

export interface WeekResult {
  /** Monday. */
  start: string
  /** Sunday. */
  end: string
  goals: WeekGoal[]
  /** Every goal done. */
  perfect: boolean
}

/** The closed weeks (Sunday before today) that lie fully in `history`, oldest first, each with its protocol's goals. */
export function closedWeeks(history: readonly DayInfo[], spans: readonly ProtocolSpan[], today: string): WeekResult[] {
  if (history.length === 0) return []
  const byDate = new Map(history.map((d) => [d.date, d]))
  const first = history.reduce((min, d) => (d.date < min ? d.date : min), history[0]!.date)
  const out: WeekResult[] = []
  let monday = weekStart(first)
  if (monday < first) monday = addDays(monday, 7)
  for (; addDays(monday, 6) < today; monday = addDays(monday, 7)) {
    const days = dateRange(monday, addDays(monday, 6)).map((d) => byDate.get(d))
    if (days.some((d) => d === undefined)) continue
    const sunday = addDays(monday, 6)
    const goals = weekGoals(days as DayInfo[], protocolOn(sunday, spans)?.document ?? null)
    out.push({ start: monday, end: sunday, goals, perfect: goals.length > 0 && goals.every((g) => g.done) })
  }
  return out
}

export type MedalKey = 'perfect_week' | 'diet_100_7' | 'streak_7' | 'streak_14' | 'streak_30' | 'all_workouts_cycle'

export interface Medal {
  key: MedalKey
  /** pt-BR. */
  label: string
  /** The most recent date it was earned, null while locked. */
  earnedOn: string | null
  /** Times earned in the history. */
  count: number
  /** Toward the next one: the current week / run / cycle (value ≤ target, except when target is 0). */
  progress: { value: number; target: number }
}

export interface MedalInputs {
  /** `closedWeeks(...)`. */
  weeks: readonly WeekResult[]
  /** `cycleWorkouts(...)`. */
  cycles: readonly CycleWorkouts[]
  /** Goals of the week of today. */
  currentWeek: readonly WeekGoal[]
}

export const MEDAL_LABELS: Record<MedalKey, string> = {
  perfect_week: 'Semana perfeita',
  diet_100_7: 'Dieta 100% por 7 dias',
  streak_7: 'Sequência de 7 dias',
  streak_14: 'Sequência de 14 dias',
  streak_30: 'Sequência de 30 dias',
  all_workouts_cycle: 'Todos os treinos do ciclo',
}

/**
 * Medals derived from the history (nothing stored):
 * - perfect_week: a closed week with every goal done; earned on its Sunday.
 * - diet_100_7: 7 days in a row with every meal done (days without meals are skipped; today joins once complete).
 * - streak_7/14/30: the streak reaching 7/14/30 days; earned on the day it got there.
 * - all_workouts_cycle: a closed cycle (its update date passed, or a newer protocol came) with planned workouts, all
 *   done; earned on the cycle's last day. Progress: the cycle in force today.
 */
export function medals(history: readonly DayInfo[], today: string, inputs: MedalInputs): Medal[] {
  const medal = (key: MedalKey, earned: readonly string[], value: number, target: number): Medal => ({
    key,
    label: MEDAL_LABELS[key],
    earnedOn: earned.length === 0 ? null : [...earned].sort().at(-1)!,
    count: earned.length,
    progress: { value: target > 0 ? Math.min(value, target) : value, target },
  })

  const perfect = inputs.weeks.filter((w) => w.perfect).map((w) => w.end)
  const weekDone = inputs.currentWeek.filter((g) => g.done).length

  const diet = (n: number) =>
    walkRuns(
      history.map((d) => ({ date: d.date, state: d.dietComplete === null ? 'skip' : d.dietComplete ? 'hit' : 'miss' })),
      today,
      n,
    )
  const scores = (n: number) => walkRuns(history.map((d) => ({ date: d.date, state: scoreState(d.score) })), today, n)
  const diet7 = diet(7)

  const cycleEarned = inputs.cycles.filter((c) => c.closed && c.planned > 0 && c.done === c.planned && c.end !== null).map((c) => c.end!)
  const current = inputs.cycles.find((c) => !c.closed && c.start <= today) ?? null

  return [
    medal('perfect_week', perfect, weekDone, inputs.currentWeek.length),
    medal('diet_100_7', diet7.reached, diet7.current, 7),
    ...([7, 14, 30] as const).map((n) => {
      const r = scores(n)
      return medal(`streak_${n}`, r.reached, r.current, n)
    }),
    medal('all_workouts_cycle', cycleEarned, current?.done ?? 0, current?.planned ?? 0),
  ]
}

/** Whether `date` is in a span (inclusive; an open end runs on). */
export const inSpan = (date: string, span: Pick<ProtocolSpan, 'activatedOn' | 'end'>): boolean =>
  date >= span.activatedOn && (span.end === null || date <= span.end)
