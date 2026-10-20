import { workoutDocumentSchema, type PlannedExercise, type PlannedSet, type WorkoutDocument } from '../../../domain/planDocuments'
import { freshKey, isLowConfidence, updateList } from '../docEdit'
import { validateWorkout, type Issue } from '../validation'

export type Step = { kind: 'rotation' } | { kind: 'day'; index: number } | { kind: 'new' } | { kind: 'activate' }

/** Rotação, one step per day, Exercícios novos (only when there are any) and Ativar. */
export function buildSteps(doc: WorkoutDocument, hasNew: boolean): Step[] {
  return [
    { kind: 'rotation' },
    ...doc.days.map((_, index): Step => ({ kind: 'day', index })),
    ...(hasNew ? [{ kind: 'new' } as Step] : []),
    { kind: 'activate' },
  ]
}

/** The letter that names a day: its key when that is one letter (`a`), else its position. */
export function dayLetter(key: string, index: number): string {
  return /^[a-z]$/i.test(key) ? key.toUpperCase() : String.fromCharCode(65 + (index % 26))
}

export function dayLabel(doc: WorkoutDocument, index: number): string {
  const day = doc.days[index]!
  const letter = dayLetter(day.key, index)
  return day.name.trim() ? `Dia ${letter} — ${day.name.trim()}` : `Dia ${letter}`
}

export function stepTitle(step: Step, doc: WorkoutDocument): string {
  switch (step.kind) {
    case 'rotation':
      return 'Rotação'
    case 'day':
      return dayLabel(doc, step.index)
    case 'new':
      return 'Exercícios novos'
    case 'activate':
      return 'Ativar'
  }
}

/** Index of the first day step that is not confirmed yet; the last step when all are. */
export function firstOpenIndex(steps: Step[], doc: WorkoutDocument, confirmed: ReadonlySet<string>): number {
  const open = steps.findIndex((s) => s.kind === 'day' && !confirmed.has(doc.days[s.index]!.key))
  return open === -1 ? steps.length - 1 : open
}

/** Dots can be tapped for the steps up to the first unconfirmed day, the current one and the confirmed days. */
export function isStepReachable(steps: Step[], i: number, current: number, doc: WorkoutDocument, confirmed: ReadonlySet<string>): boolean {
  if (i === current || i <= firstOpenIndex(steps, doc, confirmed)) return true
  const step = steps[i]!
  return step.kind === 'day' && confirmed.has(doc.days[step.index]!.key)
}

const range = (s: PlannedSet) => (s.repsMin === s.repsMax ? `${s.repsMin}` : `${s.repsMin}-${s.repsMax}`)

function extras(s: PlannedSet): string {
  const parts: string[] = []
  const drops = s.drops ?? (s.technique?.trim().toLowerCase() === 'drop' ? 1 : 0)
  if (drops > 0) parts.push(drops === 1 ? '+drop' : `+${drops} drops`)
  if ((s.restPause ?? 0) > 0) parts.push(s.restPause === 1 ? '+rest-pause' : `+${s.restPause} rest-pauses`)
  return parts.join(' ')
}

/** "4× 10–15" when every set is alike; otherwise the pyramid, "15-20 · 10-15 · 8-12 +drop". */
export function setsSummary(sets: readonly PlannedSet[]): string {
  if (sets.length === 0) return 'Sem séries'
  const labels = sets.map((s) => [range(s), extras(s)].filter(Boolean).join(' '))
  if (labels.every((l) => l === labels[0])) {
    const first = sets[0]!
    const reps = first.repsMin === first.repsMax ? `${first.repsMin}` : `${first.repsMin}–${first.repsMax}`
    return [`${sets.length}× ${reps}`, extras(first)].filter(Boolean).join(' ')
  }
  return labels.join(' · ')
}

/** The sub-fields of an exercise that the extraction flagged, in words ("séries", "descanso"). */
export function lowFields(lows: readonly string[], base: string): string[] {
  const fields: [string, string][] = [
    ['name', 'nome'],
    ['sets', 'séries'],
    ['restSeconds', 'descanso'],
    ['technique', 'técnica'],
    ['techniques', 'técnicas'],
  ]
  return fields.filter(([key]) => isLowConfidence(lows, `${base}.${key}`)).map(([, word]) => word)
}

const bracket = (path: PropertyKey[]) => path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)), '')

/** Messages by field path (`days[0].exercises[1].techniques[0].count`): the schema's findings and the activation rules. */
export function fieldErrors(doc: WorkoutDocument): Record<string, string> {
  const errors: Record<string, string> = {}
  const parsed = workoutDocumentSchema.safeParse(doc)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = bracket(issue.path)
      if (path in errors) continue
      errors[path] =
        issue.code === 'invalid_type'
          ? 'Obrigatório.'
          : issue.code === 'too_small' || issue.code === 'too_big'
            ? 'Valor fora da faixa.'
            : issue.message === 'set index out of range'
              ? 'Escolha séries que existem.'
              : issue.message.startsWith('bi-set')
                ? 'Escolha outro exercício do mesmo dia.'
                : 'Valor inválido.'
    }
  }
  for (const issue of validateWorkout(doc)) if (issue.path !== 'document' && !(issue.path in errors)) errors[issue.path] = issue.message
  return errors
}

/** Whether the day (or the document as a whole) has something that blocks saving it. */
export function dayBlocked(issues: readonly Issue[], index: number): boolean {
  return issues.some((i) => i.path === 'document' || i.path === 'days' || i.path.startsWith(`days[${index}]`))
}

/** Adds a blank exercise to a day; returns the new document and the position of the exercise. */
export function withNewExercise(doc: WorkoutDocument, dayIndex: number): { doc: WorkoutDocument; index: number } {
  const day = doc.days[dayIndex]!
  const key = freshKey('e', day.exercises.map((e) => e.key))
  const next = updateList<WorkoutDocument, PlannedExercise>(doc, `days[${dayIndex}].exercises`, (list) => [...list, { key, name: '', sets: [{ repsMin: 8, repsMax: 12 }] }])
  return { doc: next, index: day.exercises.length }
}

