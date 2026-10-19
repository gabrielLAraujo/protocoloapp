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

/** The version active on `date`: the one with the greatest `activatedOn <= date`; on a tie the later entry in `plans` wins. */
export function activePlanAt(date: string, plans: WorkoutPlanAt[]): WorkoutPlanAt | null {
  let active: WorkoutPlanAt | null = null
  for (const plan of plans) {
    if (plan.activatedOn <= date && (!active || plan.activatedOn >= active.activatedOn)) active = plan
  }
  return active
}

function asResult(dayKey: string | undefined, planVersionId: string): ResolvedDay {
  if (!dayKey || dayKey === OFF) return { kind: 'off' }
  return { kind: 'workout', dayKey, planVersionId }
}

/**
 * Position in `items` on `date`, counted from an anchor. The anchor starts at the rotation's anchor / the version's
 * `activatedOn` (position 0) and each earlier override inside the active version re-anchors it:
 * - a workout key sets the position to the occurrence of that key nearest to where the rotation would have been;
 * - `off` postpones the rotation by one day (the skipped workout comes next), unless that day was already a rest day.
 */
function sequenceIndex(date: string, plan: WorkoutPlanAt, items: string[], overrides: RotationOverrideAt[]): number {
  const n = items.length
  let anchorDate = plan.rotation.anchor ?? plan.activatedOn
  let anchorIndex = 0
  // Only overrides inside the active version count as anchors (earlier ones refer to another plan).
  const anchors = overrides
    .filter((o) => o.date < date && o.date >= plan.activatedOn)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const o of anchors) {
    const natural = mod(anchorIndex + diffDays(anchorDate, o.date), n)
    let next: number
    if (o.dayKey === OFF) {
      next = items[natural] === OFF ? natural : mod(natural - 1, n)
    } else {
      let best = -1
      let bestDistance = Infinity
      items.forEach((item, i) => {
        if (item !== o.dayKey) return
        const distance = Math.min(mod(i - natural, n), mod(natural - i, n))
        if (distance < bestDistance) {
          best = i
          bestDistance = distance
        }
      })
      if (best < 0) continue
      next = best
    }
    anchorDate = o.date
    anchorIndex = next
  }
  return mod(anchorIndex + diffDays(anchorDate, date), n)
}

/**
 * What to do on `date`. A direct override for that date wins. Otherwise `sequence` counts days from an anchor (see `sequenceIndex`). `fixed_weekdays` uses the local weekday.
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

    return asResult(items[sequenceIndex(date, plan, items, overrides)], plan.planVersionId)
  }

  return { kind: 'none' }
}

/** Dates in `[from, to]` (inclusive) that resolve to a workout, using the version active on each day. */
export function plannedWorkoutDays(from: string, to: string, plans: WorkoutPlanAt[], overrides: RotationOverrideAt[]): string[] {
  return dateRange(from, to).filter((d) => resolveDay(d, plans, overrides).kind === 'workout')
}
