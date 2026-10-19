import { adherenceRepo, type AdherenceLogLocal } from '../../data/adherenceRepo'
import { checkinParts, dailyCheckinRepo, type DailyCheckin } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { planRepo } from '../../data/planRepo'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { addDays, dateRange } from '../../domain/calendarDate'
import { buildDay } from '../../domain/dayPlan'
import { parseProtocolDocument, type ProtocolDocument } from '../../domain/planDocuments'
import {
  buildDayInfo,
  closedWeeks,
  cycleWorkouts,
  inSpan,
  medals,
  protocolOn,
  protocolSpans,
  streak,
  weekGoals,
  weekStart,
  type DayInfo,
  type DayScore,
  type Medal,
  type ProtocolSpan,
  type Streak,
  type WeekGoal,
  type WeekResult,
} from '../../domain/progress'
import { resolveTargetStatus, targetId } from '../../domain/targetStatus'
import { localDate } from '../checkin/localDate'
import { toDayPlans } from '../today/todayData'
import { loadWorkoutPlans } from '../workout/workoutPlans'

/** How far back the history goes at most (today included). */
export const HISTORY_DAYS = 90

export interface ProgressData {
  today: string
  /** From the first activation (protocol or workout plan; at most HISTORY_DAYS back) to today, oldest first. */
  history: DayInfo[]
  /** Monday to Sunday of the week of today (future days have `when: 'future'`). */
  week: DayInfo[]
  todayScore: DayScore
  streak: Streak
  /** Best streak inside the protocol cycle in force today (0 without one). */
  cycleBest: number
  weekGoals: WeekGoal[]
  /** Closed weeks fully inside the history ("Semanas na meta": the `perfect` ones). */
  weeks: WeekResult[]
  medals: Medal[]
  /** The protocol cycle in force today, or null. */
  cycle: ProtocolSpan | null
}

async function loadProtocolSpans(db: LocalDb): Promise<ProtocolSpan[]> {
  const versions = await planRepo.list(db, 'protocol')
  const parsed: { activatedOn: string; activatedAt: string; document: ProtocolDocument }[] = []
  for (const v of versions) {
    if (v.status === 'draft' || v.activatedAt === null) continue
    const doc = parseProtocolDocument(v.document)
    if (doc.ok) parsed.push({ activatedOn: localDate(new Date(v.activatedAt)), activatedAt: v.activatedAt, document: doc.value })
  }
  return protocolSpans(parsed)
}

/**
 * Reads everything once (plans, schedule, marks, check-ins, workout days) and computes the day history, the week, the
 * streak, the week goals and the medals in memory. `now` is the clock for today's due targets.
 */
export async function loadProgress(db: LocalDb, today: string, now: Date = new Date()): Promise<ProgressData> {
  const [spans, plans, slots] = await Promise.all([loadProtocolSpans(db), loadWorkoutPlans(db), scheduleRepo.all(db)])
  const activations = [...spans.map((s) => s.activatedOn), ...plans.map((p) => p.at.activatedOn)].sort()
  const windowStart = addDays(today, -(HISTORY_DAYS - 1))
  const first = activations[0] ?? today
  const historyStart = first > today ? today : first < windowStart ? windowStart : first
  const monday = weekStart(today)
  const sunday = addDays(monday, 6)
  const from = monday < historyStart ? monday : historyStart

  const current = protocolOn(today, spans)
  const planEnd = current?.end && current.end > sunday ? current.end : sunday
  // Overrides re-anchor the rotation from each version's activation: load them since the first one (as /treino).
  const overridesFrom = plans.map((p) => p.at.activatedOn).sort()[0] ?? from
  const [logs, checkins, worked, overrides] = await Promise.all([
    adherenceRepo.between(db, from, today),
    dailyCheckinRepo.between(db, from, today),
    workoutRepo.workedOutDates(db, from, today),
    rotationOverrideRepo.between(db, overridesFrom, planEnd),
  ])

  const logsByDate = new Map<string, AdherenceLogLocal[]>()
  for (const l of logs) logsByDate.set(l.date, [...(logsByDate.get(l.date) ?? []), l])
  const checkinByDate = new Map<string, DailyCheckin>(checkins.map((c) => [c.date, c]))
  const workedOut = new Set(worked)
  const dayPlans = toDayPlans(plans)
  const plansAt = plans.map((p) => p.at)

  const days = dateRange(from, sunday).map((date): DayInfo => {
    const span = protocolOn(date, spans)
    const plan = buildDay(date, span?.document ?? null, dayPlans, overrides, slots, { protocolActivatedOn: span?.activatedOn ?? null })
    const dayLogs = logsByDate.get(date) ?? []
    const find = (type: AdherenceLogLocal['targetType'], key: string) => dayLogs.find((l) => l.targetType === type && l.targetKey === key) ?? null
    const checkin = checkinByDate.get(date) ?? null
    const parts = checkin ? checkinParts(checkin) : { morning: false, evening: false }
    const derived = { workoutDone: workedOut.has(date), checkinParts: parts }
    const statuses = new Map(plan.targets.map((t) => [targetId(t), resolveTargetStatus(t, find, derived).status]))
    return buildDayInfo(
      {
        date,
        when: date < today ? 'past' : date === today ? 'today' : 'future',
        plan,
        statuses,
        checkinParts: parts,
        waterL: checkin?.waterL ?? null,
        cardioOnCheckin: checkin?.cardioDone === true,
        cardioOptional: span?.document.cardio != null && span.document.cardio.daily !== true,
      },
      now,
    )
  })

  const history = days.filter((d) => d.date >= historyStart && d.date <= today)
  const week = days.filter((d) => d.date >= monday)
  const goals = weekGoals(week, current?.document ?? null)
  const weeks = closedWeeks(history, spans, today)
  const cycles = cycleWorkouts(spans, today, historyStart, plansAt, overrides, workedOut)

  return {
    today,
    history,
    week,
    todayScore: days.find((d) => d.date === today)!.score,
    streak: streak(history, today),
    cycleBest: current ? streak(history.filter((d) => inSpan(d.date, current)), today).best : 0,
    weekGoals: goals,
    weeks,
    medals: medals(history, today, { weeks, cycles, currentWeek: goals }),
    cycle: current,
  }
}
