import { dateRange, diffDays, weekdayOf } from './calendarDate'
import { OFF, type Rotation } from './planDocuments'

export interface WorkoutPlanAt {
  planVersionId: string
  /** Local calendar date (yyyy-MM-dd) the version became active. */
  activatedOn: string
  rotation: Rotation
}

/** A manual choice for one date: the workout day to do (or `off`). */
export interface RotationOverrideAt {
  date: string
  dayKey: string
}

export type ResolvedDay = { kind: 'workout'; dayKey: string; planVersionId: string } | { kind: 'off' } | { kind: 'none' }

const mod = (n: number, m: number) => ((n % m) + m) % m

/** The version active on `date`: the one with the greatest `activatedOn <= date`. */
export function activePlanAt(date: string, plans: WorkoutPlanAt[]): WorkoutPlanAt | null {
  let active: WorkoutPlanAt | null = null
  for (const plan of plans) {
    if (plan.activatedOn <= date && (!active || plan.activatedOn > active.activatedOn)) active = plan
  }
  return active
}

function asResult(dayKey: string | undefined, planVersionId: string): ResolvedDay {
  if (!dayKey || dayKey === OFF) return { kind: 'off' }
  return { kind: 'workout', dayKey, planVersionId }
}

/**
 * What to do on `date`. A direct override for that date wins. Otherwise `sequence` counts days from an anchor: the latest
 * override on or before `date` (its position in the sequence) or, without one, the rotation's anchor / the version's
 * `activatedOn` (position 0). `fixed_weekdays` uses the local weekday.
 */
export function resolveDay(date: string, plans: WorkoutPlanAt[], overrides: RotationOverrideAt[]): ResolvedDay {
  const plan = activePlanAt(date, plans)
  if (!plan) return { kind: 'none' }

  const direct = overrides.find((o) => o.date === date)
  if (direct) return asResult(direct.dayKey, plan.planVersionId)

  const { rotation } = plan
  if (rotation.type === 'fixed_weekdays') {
    if (!rotation.map) return { kind: 'none' }
    return asResult(rotation.map[weekdayOf(date)], plan.planVersionId)
  }

  if (rotation.type === 'sequence') {
    const items = rotation.items ?? []
    if (items.length === 0) return { kind: 'none' }

    let anchorDate = rotation.anchor ?? plan.activatedOn
    let anchorIndex = 0
    // Only overrides inside the active version count as anchors (earlier ones refer to another plan).
    const anchors = overrides
      .filter((o) => o.date <= date && o.date >= plan.activatedOn && items.includes(o.dayKey))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    if (anchors.length > 0) {
      anchorDate = anchors[0].date
      anchorIndex = items.indexOf(anchors[0].dayKey)
    }
    return asResult(items[mod(anchorIndex + diffDays(anchorDate, date), items.length)], plan.planVersionId)
  }

  return { kind: 'none' }
}

/** Dates in `[from, to]` (inclusive) that resolve to a workout, using the version active on each day. */
export function plannedWorkoutDays(from: string, to: string, plans: WorkoutPlanAt[], overrides: RotationOverrideAt[]): string[] {
  return dateRange(from, to).filter((d) => resolveDay(d, plans, overrides).kind === 'workout')
}
