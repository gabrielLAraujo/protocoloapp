import type { AdherenceLogLocal } from '../../data/adherenceRepo'
import { localDate } from '../checkin/localDate'
import type { DailyCheckin } from '../../data/dailyCheckinRepo'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import { dateRange, diffDays } from '../../domain/calendarDate'
import { cycleInfo, type CycleInfo } from '../../domain/cycle'
import { buildDay, type DaySlot, type DayWorkoutPlan } from '../../domain/dayPlan'
import type { MuscleGroup } from '../../domain/muscleGroups'
import type { ProtocolDocument } from '../../domain/planDocuments'
import { plannedWorkoutDays, resolveDay, type RotationOverrideAt, type WorkoutPlanAt } from '../../domain/rotation'
import { strengthByGroup, type GroupTrends } from '../../domain/strength'

export interface SummaryInput {
  /** The active protocol; null when none was imported yet. `activatedOn` is the local date of its activation. */
  protocol: { activatedOn: string; document: ProtocolDocument } | null
  /** Every workout version that was active at some point. */
  plans: WorkoutPlanAt[]
  overrides: RotationOverrideAt[]
  sessions: SessionLocal[]
  sets: SetLocal[]
  checkins: DailyCheckin[]
  exercises: ExerciseLocal[]
  /** Days with a cardio `done` mark (Hoje); counted with the check-in's "Sim", once per day. */
  cardioMarkDates?: readonly string[]
}

export type DayState = 'done' | 'missed' | 'rest' | 'future' | 'today'

export interface CalendarDay {
  date: string
  state: DayState
  /** Cardio was checked in on this day. */
  cardio: boolean
  /** The rotation (with overrides, using the plan version active that day) asks for a workout. */
  planned: boolean
  /** A session with at least one working (non-warm-up) set was logged on this day. */
  done: boolean
}

export interface Ratio {
  done: number
  planned: number
}

export interface WeightPoint {
  date: string
  kg: number
}

export interface SummaryData {
  /** Null without an active protocol. */
  cycle: CycleInfo | null
  /** First and last day shown in the calendar (the cycle, or start..today without an update date). */
  calendar: CalendarDay[]
  workouts: Ratio
  cardio: Ratio
  /** Averages with one decimal; null without check-ins in the cycle so far. */
  sleep: number | null
  energyWake: number | null
  energyDay: number | null
  anxiety: number | null
  water: number | null
  waterTarget: number | null
  checkinCount: number
  weight: WeightPoint[]
  strength: Record<MuscleGroup, GroupTrends> | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return round1(values.reduce((a, b) => a + b, 0) / values.length)
}

/** The planned cardio sessions up to `elapsedDays` days into the cycle. */
function plannedCardio(protocol: ProtocolDocument, elapsedDays: number): number {
  const cardio = protocol.cardio
  if (!cardio || elapsedDays <= 0) return 0
  if (cardio.daily) return elapsedDays
  if (cardio.sessionsPerWeek) return Math.floor((cardio.sessionsPerWeek * elapsedDays) / 7)
  return 0
}

/** Pure: everything the summary screen shows, for the cycle of the active protocol up to `today`. */
export function buildSummary(input: SummaryInput, today: string): SummaryData {
  const { protocol } = input
  if (!protocol) {
    return {
      cycle: null, calendar: [], workouts: { done: 0, planned: 0 }, cardio: { done: 0, planned: 0 },
      sleep: null, energyWake: null, energyDay: null, anxiety: null, water: null, waterTarget: null,
      checkinCount: 0, weight: [], strength: null,
    }
  }

  const cycle = cycleInfo(
    { activatedOn: protocol.activatedOn, updateDate: protocol.document.updateDate ?? null, billingDate: protocol.document.billingDate ?? null },
    today,
  )
  const start = cycle.start
  // Statistics stop at today (or at the update date once the cycle is over).
  const statsTo = cycle.end && cycle.end < today ? cycle.end : today
  const started = start <= statsTo
  const calendarTo = cycle.end ?? (today > start ? today : start)

  // A session counts as a workout done only with at least one working set (an empty or warm-up-only session is not a workout).
  const withWorkingSets = new Set(input.sets.filter((s) => s.kind !== 'warmup').map((s) => s.sessionId))
  const sessionDates = new Set(input.sessions.filter((s) => s.date >= start && s.date <= statsTo && withWorkingSets.has(s.id)).map((s) => s.date))
  const cardioDates = new Set(
    [...input.checkins.filter((c) => c.cardioDone === true).map((c) => c.date), ...(input.cardioMarkDates ?? [])].filter((d) => d >= start && d <= calendarTo),
  )

  const calendar: CalendarDay[] = dateRange(start, calendarTo).map((date) => {
    const planned = resolveDay(date, input.plans, input.overrides).kind === 'workout'
    const done = sessionDates.has(date)
    let state: DayState
    if (date > today) state = 'future'
    else if (date === today) state = 'today'
    else if (done) state = 'done'
    else state = planned ? 'missed' : 'rest'
    return { date, state, cardio: cardioDates.has(date), planned, done }
  })

  const plannedDays = started ? plannedWorkoutDays(start, statsTo, input.plans, input.overrides) : []
  const elapsedDays = started ? diffDays(start, statsTo) + 1 : 0

  const inRange = input.checkins.filter((c) => c.date >= start && c.date <= statsTo)
  const guideline = protocol.document.guidelines.find((g) => g.kind === 'water_min_l' && typeof g.value === 'number')

  return {
    cycle,
    calendar,
    workouts: { done: sessionDates.size, planned: plannedDays.length },
    cardio: {
      done: [...cardioDates].filter((d) => d <= statsTo).length,
      planned: plannedCardio(protocol.document, elapsedDays),
    },
    sleep: average(inRange.map((c) => c.sleepQuality)),
    energyWake: average(inRange.map((c) => c.energyWake)),
    energyDay: average(inRange.map((c) => c.energyDay)),
    anxiety: average(inRange.map((c) => c.anxiety)),
    water: average(inRange.map((c) => c.waterL)),
    waterTarget: guideline?.value ?? null,
    checkinCount: inRange.length,
    weight: inRange
      .filter((c): c is DailyCheckin & { weightKg: number } => c.weightKg !== null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((c) => ({ date: c.date, kg: c.weightKg })),
    strength: started ? strengthByGroup(input.sessions, input.sets, input.exercises, start, statsTo) : null,
  }
}


/** Marks of planned targets: done counts 1, partial 0.5. */
export interface AdherenceRate {
  done: number
  partial: number
  planned: number
}

export interface AdherenceInput {
  protocol: { activatedOn: string; document: ProtocolDocument }
  /** Every workout version that was active, with its full activation instant (buildDay orders by it). */
  workoutPlans: DayWorkoutPlan[]
  overrides: RotationOverrideAt[]
  adherence: AdherenceLogLocal[]
  /** The reminder times: today, a target is only due once its time has come. */
  slots: readonly DaySlot[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Diet (meals) and protocol items from `from` to `to` (inclusive): what buildDay plans for each day, and how much of
 * it was marked. A mark of something not planned that day does not count. On past days every planned target counts;
 * today (the local date of `now`) only the marked ones and those whose time has come, so the morning does not read low.
 */
export function adherenceRates(input: AdherenceInput, from: string, to: string, now: Date): { diet: AdherenceRate; items: AdherenceRate } {
  const today = localDate(now)
  const clock = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  const diet: AdherenceRate = { done: 0, partial: 0, planned: 0 }
  const items: AdherenceRate = { done: 0, partial: 0, planned: 0 }
  const marks = new Map(input.adherence.map((l) => [`${l.date}\n${l.targetType}\n${l.targetKey}`, l.status]))
  for (const date of dateRange(from, to)) {
    const plan = buildDay(date, input.protocol.document, input.workoutPlans, input.overrides, input.slots, { protocolActivatedOn: input.protocol.activatedOn })
    for (const t of plan.targets) {
      const rate = t.type === 'meal' ? diet : t.type === 'protocol_item' ? items : null
      if (!rate) continue
      const status = marks.get(`${date}\n${t.type}\n${t.key}`)
      if (date === today && status === undefined && (t.time === null || t.time > clock)) continue
      rate.planned++
      if (status === 'done') rate.done++
      else if (status === 'partial') rate.partial++
    }
  }
  return { diet, items }
}

/** Rounded percent ("63%" for 62.5%), or "—" when nothing was planned. */
export const formatRate = (rate: AdherenceRate): string =>
  rate.planned === 0 ? '—' : `${Math.round(((2 * rate.done + rate.partial) * 50) / rate.planned)}%` // (done + 0.5 × partial) / planned, in integers
