import { useContext, useState } from 'react'
import type { ExerciseLocal } from '../../../data/exerciseRepo'
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '../../../domain/muscleGroups'
import type { PlannedExercise } from '../../../domain/planDocuments'
import { techniqueExplanation, techniqueLabel } from '../../../domain/techniques'
import { ExerciseMedia } from '../../../ui/ExerciseMedia'
import { Chip } from '../../../ui/Chip'
import { Icon } from '../../../ui/Icon'
import { ConfiraBadge } from '../fields'
import { LowConfidenceContext, useIsLow } from '../lowConfidence'
import { GifPreview } from './PairPicker'
import { lowFields, setsSummary } from './steps'

type Props = {
  exercise: PlannedExercise
  base: string
  catalogId: string | null
  group: MuscleGroup | null
  /** The user's exercise this one points to, when it does. */
  linked: ExerciseLocal | null
  /** What is wrong with this exercise's fields (empty when nothing is). */
  errors: string[]
  onEdit(): void
}

/** One exercise of a day, compact: demonstration, name, group, sets, technique tags. Tapping the row opens the editor. */
export function ExerciseRow({ exercise, base, catalogId, group, linked, errors, onEdit }: Props) {
  const low = useIsLow(base)
  const lows = useContext(LowConfidenceContext)
  const [open, setOpen] = useState<number | null>(null)
  const fields = low ? lowFields(lows, base) : []
  const name = exercise.name.trim() || 'Exercício sem nome'
  const techniques = exercise.techniques ?? []
  const note = exercise.technique?.trim()

  return (
    <li className={`grid gap-3 rounded-card border p-3 shadow-card ${errors.length > 0 ? 'border-danger bg-surface' : low ? 'border-warn bg-surface' : 'border-line bg-surface'}`} data-low={low ? 'true' : undefined}>
      <div className="flex items-start gap-3">
        {catalogId ? <ExerciseMedia catalogId={catalogId} name={name} size="thumb" /> : <GifPreview url={null} className="size-16" />}
        <button
          type="button"
          aria-label={`Editar ${name}`}
          onClick={onEdit}
          className="-m-1 grid min-h-11 min-w-0 flex-1 gap-0.5 rounded-control p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-base font-semibold text-ink">{name}</span>
            <Icon name="chevronRight" size={18} className="mt-0.5 shrink-0 text-muted" />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {group && <Chip>{MUSCLE_GROUP_LABELS[group]}</Chip>}
            {linked && linked.name !== exercise.name.trim() && <span className="text-xs">no app: {linked.name}</span>}
          </span>
          <span className="pt-0.5 text-sm font-medium text-ink tabular-nums">{setsSummary(exercise.sets)}</span>
          {typeof exercise.restSeconds === 'number' && <span className="text-xs text-muted tabular-nums">descanso {exercise.restSeconds} s</span>}
        </button>
      </div>

      {(techniques.length > 0 || note) && (
        <div className="flex flex-wrap gap-1.5">
          {techniques.map((t, i) => (
            <button
              key={i}
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              className="min-h-8 rounded-full border border-control-line bg-surface px-3 text-xs font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              {techniqueLabel(t)}
            </button>
          ))}
          {note && <span className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-xs text-muted">{note}</span>}
        </div>
      )}
      {open !== null && techniques[open] && (
        <p role="note" className="rounded-control border border-line bg-raised px-3 py-2 text-sm text-ink">
          {techniqueExplanation(techniques[open]!)}
        </p>
      )}
      {errors.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Chip tone="danger">Corrigir</Chip>
          <span className="text-danger">{errors[0]}</span>
        </p>
      )}
      {low && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <ConfiraBadge />
          <span className="text-muted">{fields.length > 0 ? `Confira: ${fields.join(', ')}` : 'Confira este exercício'}</span>
        </p>
      )}
    </li>
  )
}
