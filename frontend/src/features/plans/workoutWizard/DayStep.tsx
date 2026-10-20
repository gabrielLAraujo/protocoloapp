import { useState } from 'react'
import type { WorkoutDocument } from '../../../domain/planDocuments'
import { normalizeExerciseName } from '../../../domain/exerciseNames'
import { Icon } from '../../../ui/Icon'
import { setIn } from '../docEdit'
import { TextField } from '../fields'
import { buttonClass, dangerButtonClass } from '../styles'
import { ExerciseRow } from './ExerciseRow'
import { ExerciseSheet, type PairActions } from './ExerciseSheet'
import { withNewExercise } from './steps'

type Props = PairActions & {
  doc: WorkoutDocument
  onChange(doc: WorkoutDocument): void
  dayIndex: number
  errors: Record<string, string>
  onRemoveDay(): void
}

/** A day of the plan: its name and its exercises as compact rows; a row opens the edit sheet. */
export function DayStep(props: Props) {
  const { doc, onChange, dayIndex, errors, userExercises, newExercises, onRemoveDay } = props
  const day = doc.days[dayIndex]!
  const base = `days[${dayIndex}]`
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <div className="grid gap-3">
      <TextField label="Nome do dia" path={`${base}.name`} value={day.name} error={errors[`${base}.name`]} onChange={(v) => onChange(setIn(doc, `${base}.name`, v ?? ''))} />
      {errors[`${base}.exercises`] && <p className="text-sm text-danger">{errors[`${base}.exercises`]}</p>}

      {day.exercises.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Este dia ainda não tem exercícios.</p>
      ) : (
        <ul aria-label="Exercícios do dia" className="grid gap-2">
          {day.exercises.map((exercise, j) => {
            const normalized = normalizeExerciseName(exercise.name)
            const linked = exercise.exerciseId ? (userExercises.find((e) => e.id === exercise.exerciseId) ?? null) : null
            const entry = exercise.exerciseId ? null : newExercises.find((n) => normalizeExerciseName(n.name) === normalized)
            const known = !linked && !entry && normalized !== '' ? userExercises.find((e) => [e.name, ...e.aliases].some((n) => normalizeExerciseName(n) === normalized)) : null
            return (
              <ExerciseRow
                key={exercise.key || j}
                exercise={exercise}
                base={`${base}.exercises[${j}]`}
                catalogId={linked?.catalogId ?? exercise.catalogId ?? entry?.catalogId ?? known?.catalogId ?? null}
                group={linked?.primaryMuscleGroup ?? entry?.group ?? known?.primaryMuscleGroup ?? null}
                linked={linked}
                onEdit={() => setEditing(j)}
              />
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            const added = withNewExercise(doc, dayIndex)
            onChange(added.doc)
            setEditing(added.index)
          }}
        >
          <Icon name="plus" size={18} />
          Adicionar exercício
        </button>
        <button type="button" className={dangerButtonClass} onClick={onRemoveDay}>
          Remover dia {dayIndex + 1}
        </button>
      </div>

      {editing !== null && day.exercises[editing] && (
        <ExerciseSheet
          {...props}
          exIndex={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

