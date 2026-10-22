import { loadActiveProtocol } from '../../data/activeProtocol'
import { adherenceRepo, type AdherenceLogLocal, type AdherenceReason, type AdherenceStatus } from '../../data/adherenceRepo'
import { checkinParts, dailyCheckinRepo, type CheckinParts } from '../../data/dailyCheckinRepo'
import { dietDeviationRepo, type DietDeviationLocal } from '../../data/dietDeviationRepo'
import type { LocalDb } from '../../data/localDb'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { addDays, weekdayOf, type Weekday } from '../../domain/calendarDate'
import { buildDay, type DayKind, type DayTarget, type DayWorkoutPlan } from '../../domain/dayPlan'
import type { ProtocolDocument } from '../../domain/planDocuments'
import { dayScore, waterMinL, type DayScore } from '../../domain/progress'
import { resolveTargetStatus, targetId } from '../../domain/targetStatus'
import { localDate } from '../checkin/localDate'
import { loadWorkoutPlans, type WorkoutPlanEntry } from '../workout/workoutPlans'

/** Minutes after its time before an unmarked target shows as late. */
export const LATE_AFTER_MIN = 30

export const REASON_LABELS: Record<AdherenceReason, string> = {
  no_appetite: 'Sem fome',
  no_time: 'Sem tempo',
  felt_sick: 'Passou mal',
  free_meal: 'Refeição livre',
  ran_out: 'Acabou',
  other: 'Outro',
}

/** Days (today included) the "A repor" card looks back for an item that ran out. */
export const RESTOCK_WINDOW_DAYS = 14

/** A protocol item whose last mark in the window was "Acabou": its name and the day it ran out (yyyy-MM-dd). */
export interface RestockItem {
  key: string
  name: string
  date: string
}

/** A target of today with what the screen shows about it. */
export interface TodayRow {
  target: DayTarget
  label: string
  /** The stored mark, or the derived one for workout/check-in (finished session / check-in part saved). */
  status: AdherenceStatus | null
  reason: AdherenceReason | null
  note: string | null
  /** What the item sheet lists: a food and its grams, an item and its dose, the cardio's minutes. */
  details: TodayDetail[]
  /** Meals only: what was eaten outside the plan in this meal (empty otherwise). */
  deviations: DietDeviationLocal[]
}

/** One line of the item sheet: `amount` goes right-aligned in tabular numbers; `kind` styles alternatives and notes. */
export interface TodayDetail {
  text: string
  amount?: string
  kind?: 'alternative' | 'note'
}

export interface TodayView {
  date: string
  dayType: DayKind
  /** Day name for the header ("A" for "Treino A"), only on training days. */
  workoutName: string | null
  rows: TodayRow[]
  /** The protocol asks for N cardio sessions a week (not daily): an unmarked cardio does not count in the day's score. */
  cardioOptional: boolean
  /** The day's water so far (the evening check-in's field, 0 when none) and the protocol's minimum (null without one). */
  water: { totalL: number; targetL: number | null }
  /** "A repor": the items that ran out and were not done since, in the protocol's order. */
  restock: RestockItem[]
  /** Every diet deviation of the day (they all count in the diet). */
  deviations: DietDeviationLocal[]
  /**
   * The ones shown as rows of their own: extra meals (no meal key), and those of a meal that is not on today's list
   * (the plan changed after they were recorded).
   */
  extras: DietDeviationLocal[]
}

export interface TodaySources {
  protocol: ProtocolDocument | null
  protocolActivatedOn: string | null
  plans: WorkoutPlanEntry[]
  overrides: { date: string; dayKey: string }[]
  slots: { slot: string; dayType: 'training' | 'off'; time: string; reminderEnabled: boolean }[]
  logs: AdherenceLogLocal[]
  /** Protocol item marks of the last RESTOCK_WINDOW_DAYS days, today included (the "A repor" card). */
  itemLogs: AdherenceLogLocal[]
  /** A session of the day was finished with at least one working set. */
  workoutDone: boolean
  /** Which parts of the day's check-in are saved (a full check-in from before the split counts as both). */
  checkinParts: CheckinParts
  /** The check-in says cardio was done (an unmarked cardio row then shows done). */
  cardioDone: boolean
  /** Minutes of the day's cardio as saved on the check-in (only when cardio is done there). */
  cardioMinutes: number | null
  /** Water of the day's check-in, null when none. */
  waterL: number | null
  /** The day's diet deviations. */
  deviations: DietDeviationLocal[]
}

/** Reads everything the Hoje screen needs for `date` from the device. */
export async function loadTodaySources(db: LocalDb, date: string): Promise<TodaySources> {
  const [active, plans, slots, logs, recentLogs, sessions, checkin, deviations] = await Promise.all([
    loadActiveProtocol(db),
    loadWorkoutPlans(db),
    scheduleRepo.all(db),
    adherenceRepo.between(db, date, date),
    adherenceRepo.between(db, addDays(date, 1 - RESTOCK_WINDOW_DAYS), date),
    workoutRepo.sessionsBetween(db, date, date),
    dailyCheckinRepo.get(db, date),
    dietDeviationRepo.between(db, date, date),
  ])
  // Overrides re-anchor the rotation from each version's activation: load them since the first one (as /treino).
  const overridesFrom = plans.map((p) => p.at.activatedOn).sort()[0] ?? date
  const overrides = await rotationOverrideRepo.between(db, overridesFrom, date)
  const finished = sessions.filter((s) => s.endedAt !== null)
  const sets = await Promise.all(finished.map((s) => workoutRepo.setsForSession(db, s.id)))
  return {
    protocol: active?.document ?? null,
    protocolActivatedOn: active?.plan.activatedAt ? localDate(new Date(active.plan.activatedAt)) : null,
    plans,
    overrides,
    slots,
    logs,
    itemLogs: recentLogs.filter((l) => l.targetType === 'protocol_item'),
    workoutDone: sets.some((list) => list.some((s) => s.kind !== 'warmup')),
    checkinParts: checkin ? checkinParts(checkin) : { morning: false, evening: false },
    cardioDone: checkin?.cardioDone === true,
    cardioMinutes: checkin?.cardioDone === true ? checkin.cardioMinutes : null,
    waterL: checkin?.waterL ?? null,
    deviations,
  }
}

export const toDayPlans = (plans: readonly WorkoutPlanEntry[]): DayWorkoutPlan[] =>
  plans.map((p) => ({ planVersionId: p.at.planVersionId, activatedOn: p.at.activatedOn, activatedAt: p.activatedAt, rotation: p.at.rotation }))

const grams = (n: number) => `${String(n).replace('.', ',')} g`

function detailsOf(target: DayTarget, protocol: ProtocolDocument | null): TodayDetail[] {
  if (!protocol) return []
  switch (target.type) {
    case 'meal': {
      const meal = protocol.meals.find((m) => m.key === target.key)
      if (!meal) return []
      const lines = meal.items.flatMap((item): TodayDetail[] => {
        const main: TodayDetail = item.grams == null ? { text: item.food } : { text: item.food, amount: grams(item.grams) }
        return item.alternatives.length > 0 ? [main, { text: `ou: ${item.alternatives.join(', ')}`, kind: 'alternative' }] : [main]
      })
      return meal.notes?.trim() ? [...lines, { text: meal.notes, kind: 'note' }] : lines
    }
    case 'protocol_item': {
      const item = protocol.items.find((i) => i.key === target.key)
      if (!item) return []
      return [item.doseText?.trim() ? { text: item.name, amount: item.doseText } : { text: item.name }]
    }
    case 'cardio': {
      const cardio = protocol.cardio
      if (!cardio) return []
      const lines: TodayDetail[] = []
      if (cardio.durationMin) lines.push({ text: 'Duração', amount: `${cardio.durationMin} min` })
      if (cardio.intensity?.trim()) lines.push({ text: 'Intensidade', amount: cardio.intensity.trim() })
      return lines
    }
    default:
      return []
  }
}

/**
 * Pure: the items to restock on `date`. An item is listed when its last mark (by date) within the window is "Acabou";
 * a later mark ("Feito", or any other) takes it off. Items no longer in the protocol are left out.
 */
export function restockItems(date: string, itemLogs: readonly AdherenceLogLocal[], protocol: ProtocolDocument | null): RestockItem[] {
  if (!protocol) return []
  const from = addDays(date, 1 - RESTOCK_WINDOW_DAYS)
  const last = new Map<string, AdherenceLogLocal>()
  for (const log of itemLogs) {
    if (log.targetType !== 'protocol_item' || log.date < from || log.date > date) continue
    const seen = last.get(log.targetKey)
    if (!seen || log.date > seen.date) last.set(log.targetKey, log)
  }
  return protocol.items.flatMap((item): RestockItem[] => {
    const log = last.get(item.key)
    return log && log.status !== 'done' && log.reason === 'ran_out' ? [{ key: item.key, name: item.name, date: log.date }] : []
  })
}

/** Pure: the Hoje screen of `date`, rows in buildDay order. */
export function buildTodayView(date: string, src: TodaySources): TodayView {
  const plan = buildDay(date, src.protocol, toDayPlans(src.plans), src.overrides, src.slots, { protocolActivatedOn: src.protocolActivatedOn })
  const find = (type: DayTarget['type'], key: string) => src.logs.find((l) => l.targetType === type && l.targetKey === key) ?? null
  const derived = { workoutDone: src.workoutDone, checkinParts: src.checkinParts, cardioDone: src.cardioDone }

  // The version active on the day names the workout ("Treino A"); buildDay only knows its key.
  const activeVersion = [...src.plans].reverse().find((p) => p.at.activatedOn <= date)
  const workoutDay = plan.workoutDayKey === null ? undefined : activeVersion?.document.days.find((d) => d.key === plan.workoutDayKey)
  const workoutTitle = workoutDay?.name.trim() || (plan.workoutDayKey === null ? null : `Treino ${plan.workoutDayKey.toUpperCase()}`)

  const rows = plan.targets.map((target): TodayRow => {
    // The legacy `checkin` mark stands for the evening part; a finished session / saved part makes the target done.
    const { log, status } = resolveTargetStatus(target, find, derived)
    const label = target.type === 'workout' && workoutTitle ? workoutTitle : target.label
    const details = detailsOf(target, src.protocol)
    if (target.type === 'cardio' && status === 'done' && src.cardioMinutes != null) details.push({ text: 'Feito', amount: `${src.cardioMinutes} min` })
    return {
      target,
      label,
      status,
      reason: status === log?.status ? (log?.reason ?? null) : null,
      note: status === log?.status ? (log?.note ?? null) : null,
      details,
      deviations: target.type === 'meal' ? src.deviations.filter((d) => d.mealKey === target.key) : [],
    }
  })
  const mealKeys = new Set(rows.filter((r) => r.target.type === 'meal').map((r) => r.target.key))

  return {
    date,
    dayType: plan.dayType,
    workoutName: workoutTitle === null ? null : workoutTitle.replace(/^treino\s+/i, '') || workoutTitle,
    rows,
    cardioOptional: src.protocol?.cardio != null && src.protocol.cardio.daily !== true,
    water: { totalL: src.waterL ?? 0, targetL: waterMinL(src.protocol) },
    restock: restockItems(date, src.itemLogs, src.protocol),
    deviations: src.deviations,
    extras: src.deviations.filter((d) => d.mealKey === null || !mealKeys.has(d.mealKey)),
  }
}

const planOf = (view: TodayView) => ({ dayType: view.dayType, workoutDayKey: null, targets: view.rows.map((r) => r.target) })
const statusesOf = (view: TodayView) => new Map(view.rows.map((r) => [targetId(r.target), r.status]))

/** Today's score as the streak reads it: only what is marked or already due at `now` (same rule as loadProgress). */
export function dueScore(view: TodayView, now: Date): DayScore {
  return dayScore(planOf(view), statusesOf(view), { isToday: true, now, cardioOptional: view.cardioOptional, deviations: view.deviations.length })
}

/**
 * The day's score over everything planned for the whole day (the ring of Hoje): the same rows and rules as the
 * gamification's `dayScore`, counted as a closed day, so 100 % means every target of the day is done (and no diet
 * deviation: each one is a planned diet target not done).
 */
export function wholeDayScore(view: TodayView): DayScore {
  return dayScore(planOf(view), statusesOf(view), { isToday: false, cardioOptional: view.cardioOptional, deviations: view.deviations.length })
}

/** More than LATE_AFTER_MIN minutes past `time` (HH:mm) on `now`'s day: the one rule of "late" (rows and the hero). */
function pastLateMark(time: string, now: Date): boolean {
  const [h, m] = time.split(':').map(Number)
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h!, m! + LATE_AFTER_MIN)
  return now.getTime() > due.getTime()
}

/** Not marked and more than LATE_AFTER_MIN minutes past its time (today only). */
export function isLate(row: TodayRow, date: string, now: Date): boolean {
  if (row.status !== null || row.target.time === null || localDate(now) !== date) return false
  return pastLateMark(row.target.time, now)
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'anytime'

export const PERIOD_LABELS: Record<DayPeriod, string> = { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite', anytime: 'Sem horário' }

const PERIODS: DayPeriod[] = ['morning', 'afternoon', 'evening', 'anytime']

/** Manhã until 11:59, Tarde 12:00–17:59, Noite from 18:00; no time is "Sem horário". */
export function periodOf(time: string | null): DayPeriod {
  if (time === null) return 'anytime'
  return time < '12:00' ? 'morning' : time < '18:00' ? 'afternoon' : 'evening'
}

/** The rows by period of the day, in the day's order, keeping their order inside each period; empty periods are left out. */
export function groupByPeriod<R extends { target: { time: string | null } }>(rows: readonly R[]): { period: DayPeriod; rows: R[] }[] {
  return PERIODS.map((period) => ({ period, rows: rows.filter((r) => periodOf(r.target.time) === period) })).filter((g) => g.rows.length > 0)
}

export type TimelineItem<R> = { kind: 'target'; row: R } | { kind: 'extra'; deviation: DietDeviationLocal }

/**
 * The rows and the extra meals by period: each extra goes into the period of its time ("Sem horário" without one),
 * before the first row of that period that comes later; extras keep their own order. Empty periods are left out.
 */
export function timelineGroups<R extends { target: { time: string | null } }>(
  rows: readonly R[],
  extras: readonly DietDeviationLocal[],
): { period: DayPeriod; items: TimelineItem<R>[] }[] {
  return PERIODS.map((period) => {
    const items: TimelineItem<R>[] = rows.filter((r) => periodOf(r.target.time) === period).map((row) => ({ kind: 'target', row }))
    for (const deviation of extras) {
      if (periodOf(deviation.time) !== period) continue
      const at =
        deviation.time === null
          ? -1
          : items.findIndex((item) => {
              const time = item.kind === 'target' ? item.row.target.time : item.deviation.time
              return time !== null && time > deviation.time!
            })
      items.splice(at === -1 ? items.length : at, 0, { kind: 'extra', deviation })
    }
    return { period, items }
  }).filter((g) => g.items.length > 0)
}

/**
 * The task the hero shows: the first open row that is not late yet (its time is ahead, or less than LATE_AFTER_MIN
 * minutes past), else the first late one, else the first open row without a time. Null when everything is marked.
 */
export function nextRow<R extends { target: { time: string | null }; status: AdherenceStatus | null }>(rows: readonly R[], now: Date): R | null {
  const open = rows.filter((r) => r.status === null)
  const timed = open.filter((r) => r.target.time !== null)
  return (
    // Same comparison as isLate, so the hero never offers as "on time" a task it then marks "Atrasado".
    timed.find((r) => !pastLateMark(r.target.time!, now)) ??
    timed[0] ??
    open.find((r) => r.target.time === null) ??
    null
  )
}

const WEEKDAY_NAMES: Record<Weekday, string> = {
  sun: 'Domingo', mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado',
}

/** "Segunda, 20/10 · Dia de treino — B" / "… · Descanso" / "… · Sem ficha de treino". */
export function headerText(view: TodayView): string {
  const [, m, d] = view.date.split('-')
  const day = `${WEEKDAY_NAMES[weekdayOf(view.date)]}, ${d}/${m}`
  const kind =
    view.dayType === 'training'
      ? view.workoutName ? `Dia de treino — ${view.workoutName}` : 'Dia de treino'
      : view.dayType === 'off'
        ? 'Descanso'
        : 'Sem ficha de treino'
  return `${day} · ${kind}`
}
