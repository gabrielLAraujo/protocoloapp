import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import { addDays, weekdayOf, type Weekday } from '../../domain/calendarDate'
import { cycleInfo } from '../../domain/cycle'
import { plannedWorkoutDays, type RotationOverrideAt, type WorkoutPlanAt } from '../../domain/rotation'
import { bestSet, e1rm } from '../../domain/strength'
import type { E1rmPoint } from '../workout/E1rmChart'
import { cycleCalendar, workoutDates, type CalendarDay, type SummaryInput } from '../summary/summaryData'

export interface TrainingStatsInput {
  protocol: SummaryInput['protocol']
  plans: WorkoutPlanAt[]
  overrides: RotationOverrideAt[]
  sessions: SessionLocal[]
  sets: SetLocal[]
  exercises: ExerciseLocal[]
}

export interface WeekBar {
  /** Monday of the week (yyyy-MM-dd). */
  weekStart: string
  /** Days of the week (inside the period) with a workout done. */
  done: number
  /** Days of the week (inside the period) the rotation asks for a workout. */
  planned: number
}

export interface ExerciseTrend {
  exerciseId: string
  name: string
  /** Sessions in the period with a working set of this exercise. */
  sessions: number
  /** e1RM of the best set of each session, in date order. */
  points: E1rmPoint[]
}

export interface TrainingStats {
  weeks: WeekBar[]
  calendar: CalendarDay[]
  trends: ExerciseTrend[]
}

/** Weeks shown without an active protocol (the current one included). */
const WEEKS_WITHOUT_PROTOCOL = 8
/** Exercises in the load charts. */
const TOP_EXERCISES = 6

const DAYS_SINCE_MONDAY: Record<Weekday, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
const mondayOf = (date: string): string => addDays(date, -DAYS_SINCE_MONDAY[weekdayOf(date)])

/**
 * The period of the stats: the cycle of the active protocol (from its activation up to today, or up to the update date
 * once it has passed), as the summary; without a protocol, the last 8 weeks (from Monday) up to today.
 * `calendarTo` is the last day of the calendar (the whole cycle, future days included).
 */
export function trainingPeriod(protocol: TrainingStatsInput['protocol'], today: string): { from: string; statsTo: string; calendarTo: string } {
  if (!protocol) {
    const from = addDays(mondayOf(today), -7 * (WEEKS_WITHOUT_PROTOCOL - 1))
    return { from, statsTo: today, calendarTo: today }
  }
  const cycle = cycleInfo(
    { activatedOn: protocol.activatedOn, updateDate: protocol.document.updateDate ?? null, billingDate: protocol.document.billingDate ?? null, sentOn: protocol.updateSentOn ?? null },
    today,
  )
  const from = cycle.start
  const statsTo = cycle.end && cycle.end < today ? cycle.end : today
  const calendarTo = cycle.end ?? (today > from ? today : from)
  return { from, statsTo, calendarTo }
}

function weekBars(from: string, to: string, doneDates: ReadonlySet<string>, input: TrainingStatsInput): WeekBar[] {
  const weeks: WeekBar[] = []
  for (let weekStart = mondayOf(from); weekStart <= to; weekStart = addDays(weekStart, 7)) {
    const first = weekStart < from ? from : weekStart
    const sunday = addDays(weekStart, 6)
    const last = sunday > to ? to : sunday
    const planned = plannedWorkoutDays(first, last, input.plans, input.overrides).length
    let done = 0
    for (const d of doneDates) if (d >= first && d <= last) done++
    weeks.push({ weekStart, done, planned })
  }
  return weeks
}

function exerciseTrends(input: TrainingStatsInput, from: string, to: string): ExerciseTrend[] {
  const inRange = input.sessions
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt))
  const order = new Map(inRange.map((s, i) => [s.id, i]))
  // Sets grouped by session, then by exercise.
  const grouped = new Map<string, Map<string, SetLocal[]>>()
  for (const s of input.sets) {
    if (!order.has(s.sessionId)) continue
    const byExercise = grouped.get(s.sessionId) ?? new Map<string, SetLocal[]>()
    byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s])
    grouped.set(s.sessionId, byExercise)
  }

  const points = new Map<string, E1rmPoint[]>()
  for (const session of inRange) {
    for (const [exerciseId, sets] of grouped.get(session.id) ?? []) {
      const top = bestSet(sets)
      if (!top) continue
      points.set(exerciseId, [...(points.get(exerciseId) ?? []), { date: session.date, value: e1rm(top.weightKg, top.reps) }])
    }
  }

  const names = new Map(input.exercises.map((e) => [e.id, e.name]))
  return [...points]
    .map(([exerciseId, list]) => ({ exerciseId, name: names.get(exerciseId) ?? 'Exercício', sessions: list.length, points: list }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, TOP_EXERCISES)
}

/**
 * Pure: the charts of the Treino tab. Workouts done and planned per week (Monday to Sunday), the calendar of the
 * period (the same as the summary's) and the e1RM of the most trained exercises. A workout is done on a day with a
 * session (finished or not) that has at least one working (non-warm-up) set.
 */
export function buildTrainingStats(input: TrainingStatsInput, today: string): TrainingStats {
  const { from, statsTo, calendarTo } = trainingPeriod(input.protocol, today)
  const doneDates = workoutDates(input.sessions, input.sets, from, statsTo)
  const calendar = cycleCalendar({ from, to: calendarTo, today, plans: input.plans, overrides: input.overrides, doneDates })
  if (from > statsTo) return { weeks: [], calendar, trends: [] }
  return { weeks: weekBars(from, statsTo, doneDates, input), calendar, trends: exerciseTrends(input, from, statsTo) }
}
