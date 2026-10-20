import type { SetKind, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise } from '../../domain/planDocuments'

/** The kinds of the sub-sets a planned technique creates under a set. */
export type SubSetKind = 'drop' | 'rest_pause'

/** Rest before a drop sub-set: none, the load is reduced and the set goes on. */
export const DROP_REST_SECONDS = 0
/** Rest before a rest-pause sub-set. */
export const REST_PAUSE_SECONDS = 15

/** Drop load: the previous load −20 %, rounded to 1 kg, never below 0. */
export const dropLoad = (previousKg: number): number => Math.max(0, Math.round(previousKg * 0.8))

/**
 * The sub-sets planned after the set at `setIndex`, in the order they are done: rest-pauses first (same load), then the
 * drops (each one lighter). The set's own `drops`/`restPause` win; when no set of the exercise has them, the exercise's
 * `drop` technique (last/all/indexes) and `rest_pause` technique (last set) apply. Extra rows beyond the plan get none.
 */
export function plannedSubSets(planned: PlannedExercise, setIndex: number): SubSetKind[] {
  const set = planned.sets[setIndex]
  if (!set) return []
  const last = setIndex === planned.sets.length - 1
  const techniques = planned.techniques ?? []

  let drops = 0
  if (planned.sets.some((s) => s.drops != null)) drops = set.drops ?? 0
  else {
    const drop = techniques.find((t) => t.type === 'drop')
    if (drop) {
      const targeted = drop.sets === 'all' || (drop.sets === 'last' ? last : drop.sets.includes(setIndex))
      if (targeted) drops = drop.count
    }
  }

  let restPauses = 0
  if (planned.sets.some((s) => s.restPause != null)) restPauses = set.restPause ?? 0
  else {
    const restPause = techniques.find((t) => t.type === 'rest_pause')
    if (restPause && last) restPauses = restPause.count
  }

  return [...Array<SubSetKind>(restPauses).fill('rest_pause'), ...Array<SubSetKind>(drops).fill('drop')]
}

export interface SubSetSlot {
  /** Stable while the parent lives: `parentId:kind:ordinal`. */
  key: string
  kind: SetKind
  /** 1-based position among the slots of the same kind under this parent. */
  ordinal: number
  /** The stored sub-set filling this slot, when it is done. */
  logged: SetLocal | undefined
  /** Load to suggest for this slot (from the parent, or the slot before it). */
  suggestedKg: number
  /** False for a stored sub-set the plan does not have (added elsewhere or the plan changed). */
  planned: boolean
}

const byTime = (a: SetLocal, b: SetLocal) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)

/**
 * The sub-set rows under a done set. They are derived, never written in advance: each planned slot is filled by the
 * stored sub-sets of its kind in the order they were done, so reopening or reloading the session cannot duplicate them
 * (the identity of a slot is parent + kind + ordinal). Stored sub-sets beyond the plan stay visible after the planned ones.
 */
export function subSetSlots(planned: PlannedExercise, parent: SetLocal, children: SetLocal[]): SubSetSlot[] {
  const pool = new Map<SetKind, SetLocal[]>()
  for (const c of [...children].sort(byTime)) pool.set(c.kind, [...(pool.get(c.kind) ?? []), c])
  const counters = new Map<SetKind, number>()
  const take = (kind: SetKind) => {
    const ordinal = (counters.get(kind) ?? 0) + 1
    counters.set(kind, ordinal)
    return { ordinal, logged: pool.get(kind)?.shift() }
  }

  const raw: Omit<SubSetSlot, 'suggestedKg'>[] = plannedSubSets(planned, parent.setIndex).map((kind) => {
    const { ordinal, logged } = take(kind)
    return { key: `${parent.id}:${kind}:${ordinal}`, kind, ordinal, logged, planned: true }
  })
  const leftovers = [...pool.values()].flat().sort(byTime)
  for (const c of leftovers) {
    const { ordinal } = take(c.kind)
    raw.push({ key: `${parent.id}:${c.kind}:${ordinal}`, kind: c.kind, ordinal, logged: c, planned: false })
  }

  let previous = parent.weightKg
  return raw.map((slot) => {
    const suggestedKg = slot.kind === 'drop' ? dropLoad(previous) : previous
    previous = slot.logged?.weightKg ?? suggestedKg
    return { ...slot, suggestedKg }
  })
}

/** Sets done for one exercise of the session, split into main sets (by row) and the sub-sets of each. */
export function splitSets(sets: SetLocal[]): { main: SetLocal[]; childrenOf: Map<string, SetLocal[]> } {
  const main = sets.filter((s) => s.parentSetId === null).sort((a, b) => a.setIndex - b.setIndex || byTime(a, b))
  const ids = new Set(main.map((s) => s.id))
  const childrenOf = new Map<string, SetLocal[]>()
  for (const s of sets) {
    if (s.parentSetId === null || !ids.has(s.parentSetId)) continue
    childrenOf.set(s.parentSetId, [...(childrenOf.get(s.parentSetId) ?? []), s])
  }
  return { main, childrenOf }
}

/**
 * Whether a slot is removed from the screen: "Remover" on a slot ends the technique from there on, so it hides that slot
 * and every later one of the same kind under the same parent. A slot with a stored sub-set is never hidden.
 */
export function isDismissed(dismissed: ReadonlySet<string>, slot: Pick<SubSetSlot, 'key' | 'ordinal' | 'logged'>): boolean {
  if (slot.logged) return false
  const prefix = slot.key.slice(0, slot.key.lastIndexOf(':') + 1)
  for (const key of dismissed) {
    if (key.startsWith(prefix) && Number(key.slice(prefix.length)) <= slot.ordinal) return true
  }
  return false
}

/** The planned sub-set slots still to do under the done sets (the ones the user removed from the screen do not count). */
export function openSlots(planned: PlannedExercise, sets: SetLocal[], dismissed: ReadonlySet<string>): { parent: SetLocal; slot: SubSetSlot }[] {
  const { main, childrenOf } = splitSets(sets)
  return main.flatMap((parent) =>
    subSetSlots(planned, parent, childrenOf.get(parent.id) ?? [])
      .filter((slot) => slot.planned && !slot.logged && !isDismissed(dismissed, slot))
      .map((slot) => ({ parent, slot })),
  )
}

/** Main sets done whose sub-sets are all done too: the "rounds" a bi-set alternates on. */
export function finishedRounds(planned: PlannedExercise, sets: SetLocal[], dismissed: ReadonlySet<string>): number {
  const { main, childrenOf } = splitSets(sets)
  return main.filter((parent) =>
    subSetSlots(planned, parent, childrenOf.get(parent.id) ?? []).every((slot) => !slot.planned || slot.logged || isDismissed(dismissed, slot)),
  ).length
}

export const SUB_SET_LABEL: Record<SubSetKind, string> = { drop: 'Drop', rest_pause: 'Rest-pause' }
