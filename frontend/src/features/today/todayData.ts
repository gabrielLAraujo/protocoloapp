import { loadActiveProtocol } from '../../data/activeProtocol'
import { adherenceRepo, type AdherenceLogLocal, type AdherenceReason, type AdherenceStatus } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { workoutRepo } from '../../data/workoutRepo'
import { weekdayOf, type Weekday } from '../../domain/calendarDate'
import { buildDay, type DayKind, type DayTarget, type DayWorkoutPlan } from '../../domain/dayPlan'
import type { ProtocolDocument } from '../../domain/planDocuments'
import { localDate } from '../checkin/localDate'
import { loadWorkoutPlans, type WorkoutPlanEntry } from '../workout/workoutPlans'

/** Minutes after its time before an unmarked target shows as late. */
export const LATE_AFTER_MIN = 30

export const REASON_LABELS: Record<AdherenceReason, string> = {
  no_appetite: 'Sem fome',
  no_time: 'Sem tempo',
  felt_sick: 'Passou mal',
  free_meal: 'Refeição livre',
  other: 'Outro',
}

/** A target of today with what the screen shows about it. */
export interface TodayRow {
  target: DayTarget
  label: string
  /** The stored mark, or the derived one for workout/check-in (finished session / saved check-in). */
  status: AdherenceStatus | null
  reason: AdherenceReason | null
  note: string | null
  /** Text lines shown when the row is expanded. */
  details: string[]
}

export interface TodayView {
  date: string
  dayType: DayKind
  /** Day name for the header ("A" for "Treino A"), only on training days. */
  workoutName: string | null
  rows: TodayRow[]
}

export interface TodaySources {
  protocol: ProtocolDocument | null
  protocolActivatedOn: string | null
  plans: WorkoutPlanEntry[]
  overrides: { date: string; dayKey: string }[]
  slots: { slot: string; dayType: 'training' | 'off'; time: string; reminderEnabled: boolean }[]
  logs: AdherenceLogLocal[]
  /** A session of the day was finished with at least one working set. */
  workoutDone: boolean
  /** The day's check-in exists. */
  checkinSaved: boolean
}

/** Reads everything the Hoje screen needs for `date` from the device. */
export async function loadTodaySources(db: LocalDb, date: string): Promise<TodaySources> {
  const [active, plans, slots, logs, sessions, checkin] = await Promise.all([
    loadActiveProtocol(db),
    loadWorkoutPlans(db),
    scheduleRepo.all(db),
    adherenceRepo.between(db, date, date),
    workoutRepo.sessionsBetween(db, date, date),
    dailyCheckinRepo.get(db, date),
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
    workoutDone: sets.some((list) => list.some((s) => s.kind !== 'warmup')),
    checkinSaved: checkin !== null,
  }
}

export const toDayPlans = (plans: readonly WorkoutPlanEntry[]): DayWorkoutPlan[] =>
  plans.map((p) => ({ planVersionId: p.at.planVersionId, activatedOn: p.at.activatedOn, activatedAt: p.activatedAt, rotation: p.at.rotation }))

const grams = (n: number) => `${String(n).replace('.', ',')} g`

function detailsOf(target: DayTarget, protocol: ProtocolDocument | null): string[] {
  if (!protocol) return []
  switch (target.type) {
    case 'meal': {
      const meal = protocol.meals.find((m) => m.key === target.key)
      if (!meal) return []
      const lines = meal.items.flatMap((item) => {
        const main = item.grams == null ? item.food : `${item.food} — ${grams(item.grams)}`
        return item.alternatives.length > 0 ? [main, `  ou: ${item.alternatives.join(', ')}`] : [main]
      })
      return meal.notes?.trim() ? [...lines, meal.notes] : lines
    }
    case 'protocol_item': {
      const item = protocol.items.find((i) => i.key === target.key)
      if (!item) return []
      return [item.doseText?.trim() ? `${item.name} — ${item.doseText}` : item.name]
    }
    case 'cardio': {
      const cardio = protocol.cardio
      if (!cardio) return []
      const parts = [cardio.durationMin ? `${cardio.durationMin} min` : null, cardio.intensity?.trim() || null].filter((p): p is string => p !== null)
      return parts.length > 0 ? [parts.join(' · ')] : []
    }
    default:
      return []
  }
}

/** Pure: the Hoje screen of `date`, rows in buildDay order. */
export function buildTodayView(date: string, src: TodaySources): TodayView {
  const plan = buildDay(date, src.protocol, toDayPlans(src.plans), src.overrides, src.slots, { protocolActivatedOn: src.protocolActivatedOn })
  const logOf = (t: DayTarget) => src.logs.find((l) => l.targetType === t.type && l.targetKey === t.key) ?? null

  // The version active on the day names the workout ("Treino A"); buildDay only knows its key.
  const activeVersion = [...src.plans].reverse().find((p) => p.at.activatedOn <= date)
  const workoutDay = plan.workoutDayKey === null ? undefined : activeVersion?.document.days.find((d) => d.key === plan.workoutDayKey)
  const workoutTitle = workoutDay?.name.trim() || (plan.workoutDayKey === null ? null : `Treino ${plan.workoutDayKey.toUpperCase()}`)

  const rows = plan.targets.map((target): TodayRow => {
    const log = logOf(target)
    let status = log?.status ?? null
    if (target.type === 'workout' && src.workoutDone) status = 'done'
    if (target.type === 'checkin' && src.checkinSaved) status = 'done'
    const label = target.type === 'checkin' ? 'Check-in do dia' : target.type === 'workout' && workoutTitle ? workoutTitle : target.label
    return {
      target,
      label,
      status,
      reason: status === log?.status ? (log?.reason ?? null) : null,
      note: status === log?.status ? (log?.note ?? null) : null,
      details: detailsOf(target, src.protocol),
    }
  })

  return {
    date,
    dayType: plan.dayType,
    workoutName: workoutTitle === null ? null : workoutTitle.replace(/^treino\s+/i, '') || workoutTitle,
    rows,
  }
}

/** Not marked and more than LATE_AFTER_MIN minutes past its time (today only). */
export function isLate(row: TodayRow, date: string, now: Date): boolean {
  if (row.status !== null || row.target.time === null || localDate(now) !== date) return false
  const [h, m] = row.target.time.split(':').map(Number)
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h!, m! + LATE_AFTER_MIN)
  return now.getTime() > due.getTime()
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
