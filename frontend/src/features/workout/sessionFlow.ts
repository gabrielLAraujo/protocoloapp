import type { ExerciseChangeLocal, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise, WorkoutDay } from '../../domain/planDocuments'
import { restDurations } from './restDurations'
import { DROP_REST_SECONDS, REST_PAUSE_SECONDS, finishedRounds, openSlots, splitSets, type SubSetSlot } from './subSets'

/** The partner of each exercise in a bi-set. Mutual even when only one side declares it; each exercise pairs once. */
export function bisetPartners(day: WorkoutDay): Map<string, string> {
  const keys = new Set(day.exercises.map((e) => e.key))
  const partners = new Map<string, string>()
  for (const exercise of day.exercises) {
    const declared = [
      ...(exercise.techniques ?? []).flatMap((t) => (t.type === 'biset' ? [t.with] : [])),
      ...(exercise.supersetWith ? [exercise.supersetWith] : []),
    ]
    for (const other of declared) {
      if (other === exercise.key || !keys.has(other) || partners.has(exercise.key) || partners.has(other)) continue
      partners.set(exercise.key, other)
      partners.set(other, exercise.key)
    }
  }
  return partners
}

export type DayBlock =
  | { type: 'single'; planned: PlannedExercise; /** Name of the partner when a skip or swap ended the bi-set. */ endedWith: string | null }
  | { type: 'biset'; a: PlannedExercise; b: PlannedExercise }

/**
 * The cards of the day in order: a bi-set becomes one block at the place of its first exercise. Skipping or swapping
 * either exercise ends the pairing: both go back to their own cards (the sets done stay).
 */
export function dayBlocks(
  day: WorkoutDay,
  changes: Map<string, ExerciseChangeLocal>,
  /** Whether the exercise can be done (it is in the device's catalog); one that cannot ends the pairing like a skip. */
  available: (planned: PlannedExercise) => boolean = () => true,
): DayBlock[] {
  const partners = bisetPartners(day)
  const byKey = new Map(day.exercises.map((e) => [e.key, e]))
  const placed = new Set<string>()
  const blocks: DayBlock[] = []
  for (const planned of day.exercises) {
    if (placed.has(planned.key)) continue
    placed.add(planned.key)
    const partnerKey = partners.get(planned.key)
    const partner = partnerKey ? byKey.get(partnerKey) : undefined
    if (!partner) {
      blocks.push({ type: 'single', planned, endedWith: null })
      continue
    }
    if (changes.has(planned.key) || changes.has(partner.key) || !available(planned) || !available(partner)) {
      blocks.push({ type: 'single', planned, endedWith: partner.name })
      continue
    }
    placed.add(partner.key)
    blocks.push({ type: 'biset', a: planned, b: partner })
  }
  return blocks
}

/** One exercise of the session as the rest rules see it: its plan, the sets done for it and its name. */
export interface FlowExercise {
  planned: PlannedExercise
  sets: SetLocal[]
  name: string
}

export type RestDecision =
  /** Start the countdown: `durations[index]`. */
  | { kind: 'rest'; durations: number[]; index: number; label: string }
  /** Go straight on (drop, or the other exercise of the bi-set): dismiss any countdown on screen. */
  | { kind: 'skip' }
  /** Nothing planned: leave the timer as it is. */
  | { kind: 'keep' }

const restAt = (planned: PlannedExercise, index: number): number => {
  const durations = restDurations(planned)
  return durations ? durations[Math.min(index, durations.length - 1)]! : 0
}

/**
 * What the rest timer does after a set was stored (`sets` already include it; `parentId` is the main set it belongs to,
 * itself for a main set):
 * - a sub-set still to do under that set → none before a drop (0 s), 15 s before a rest-pause;
 * - else, in a bi-set whose other exercise has not done this round yet → straight to it;
 * - else the rest of the exercise for that set (in a bi-set, the longer of the two).
 */
export function restAfterSet(input: {
  exercise: FlowExercise
  partner: FlowExercise | null
  parentId: string
  dismissed: ReadonlySet<string>
}): RestDecision {
  const { exercise, partner, parentId, dismissed } = input
  const pending = openSlots(exercise.planned, exercise.sets, dismissed).filter((o) => o.parent.id === parentId)
  const next = pending[0]?.slot
  if (next) {
    if (next.kind === 'rest_pause') return { kind: 'rest', durations: [REST_PAUSE_SECONDS], index: 0, label: `${exercise.name} — rest-pause` }
    return DROP_REST_SECONDS > 0 ? { kind: 'rest', durations: [DROP_REST_SECONDS], index: 0, label: `${exercise.name} — drop` } : { kind: 'skip' }
  }

  const { main } = splitSets(exercise.sets)
  const position = Math.max(0, main.findIndex((s) => s.id === parentId))

  // In a bi-set whose other exercise has no set at this position (fewer sets), the exercise rests as on its own.
  if (partner && position < partner.planned.sets.length) {
    const mine = finishedRounds(exercise.planned, exercise.sets, dismissed)
    const theirs = finishedRounds(partner.planned, partner.sets, dismissed)
    if (theirs < mine && theirs < partner.planned.sets.length) return { kind: 'skip' }
    const seconds = Math.max(restAt(exercise.planned, position), restAt(partner.planned, position))
    return seconds > 0 ? { kind: 'rest', durations: [seconds], index: 0, label: `Bi-set: ${exercise.name} + ${partner.name}` } : { kind: 'skip' }
  }

  const durations = restDurations(exercise.planned)
  if (!durations || durations[Math.min(position, durations.length - 1)]! <= 0) return { kind: 'keep' }
  return { kind: 'rest', durations, index: position, label: exercise.name }
}

export type BisetNext = { which: 'a' | 'b'; slot: SubSetSlot | null; setNumber: number } | null

/** Which exercise of the bi-set comes next: a pending sub-set first, then the one behind (A on a tie); null when both are done. */
export function bisetNext(a: FlowExercise, b: FlowExercise, dismissed: ReadonlySet<string>): BisetNext {
  for (const [which, x] of [['a', a], ['b', b]] as const) {
    const open = openSlots(x.planned, x.sets, dismissed)[0]
    if (open) return { which, slot: open.slot, setNumber: open.parent.setIndex + 1 }
  }
  const doneA = finishedRounds(a.planned, a.sets, dismissed)
  const doneB = finishedRounds(b.planned, b.sets, dismissed)
  const leftA = doneA < a.planned.sets.length
  const leftB = doneB < b.planned.sets.length
  if (leftA && (doneA <= doneB || !leftB)) return { which: 'a', slot: null, setNumber: doneA + 1 }
  if (leftB) return { which: 'b', slot: null, setNumber: doneB + 1 }
  return null
}
