import { useState } from 'react'
import type { WorkoutDocument } from '../../../domain/planDocuments'
import { normalizeExerciseName } from '../../../domain/exerciseNames'
import { Icon } from '../../../ui/Icon'
import { setIn } from '../docEdit'
import { TextField } from '../fields'
import { buttonClass, dangerButtonClass } from '../styles'
import { ExerciseRow } from './ExerciseRow'
import { ExerciseSheet, type PairActions } from './ExerciseSheet'
import { dayLetter, exerciseErrors, withNewExercise } from './steps'
import { ACTION_ROW } from '../../../ui/styles'

type Props = PairActions & {
  doc: WorkoutDocument
  onChange(doc: WorkoutDocument): void
  dayIndex: number
  errors: Record<string, string>
  onRemoveDay(): void
  /** Where the focus goes when an exercise is removed from the sheet (its row is gone). */
  focusHeading(): void
}

/** A day of the plan: its name and its exercises as compact rows; a row opens the edit sheet. */
export function DayStep(props: Props) {
  const { doc, onChange, dayIndex, errors, userExercises, newExercises, onRemoveDay, focusHeading } = props
  const day = doc.days[dayIndex]!
  const base = `days[${dayIndex}]`
  const [editing, setEditing] = useState<number | null>(null)
  const badCount = day.exercises.filter((_, j) => exerciseErrors(errors, `${base}.exercises[${j}]`).length > 0).length

  return (
    <div className="grid gap-4">
      <TextField label="Nome do dia" path={`${base}.name`} value={day.name} error={errors[`${base}.name`]} onChange={(v) => onChange(setIn(doc, `${base}.name`, v ?? ''))} />
      {errors[`${base}.exercises`] && <p className="text-sm text-danger">{errors[`${base}.exercises`]}</p>}
      {badCount > 0 && (
        <p role="status" className="text-sm font-medium text-danger">
          {badCount === 1 ? '1 exercício precisa de correção' : `${badCount} exercícios precisam de correção`}. Toque na linha marcada.
        </p>
      )}

      {day.exercises.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-6 text-center text-sm text-muted">Este dia ainda não tem exercícios.</p>
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
                catalogId={exercise.catalogId ?? linked?.catalogId ?? entry?.catalogId ?? known?.catalogId ?? null}
                group={linked?.primaryMuscleGroup ?? entry?.group ?? known?.primaryMuscleGroup ?? null}
                linked={linked}
                errors={exerciseErrors(errors, `${base}.exercises[${j}]`)}
                onEdit={() => setEditing(j)}
              />
            )
          })}
        </ul>
      )}

      <div className={ACTION_ROW}>
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
          Remover dia {dayLetter(day.key, dayIndex)}
        </button>
      </div>

      {editing !== null && day.exercises[editing] && (
        <ExerciseSheet
          {...props}
          exIndex={editing}
          onClose={() => setEditing(null)}
          onRemoved={() => setTimeout(focusHeading, 0)}
        />
      )}
    </div>
  )
}

