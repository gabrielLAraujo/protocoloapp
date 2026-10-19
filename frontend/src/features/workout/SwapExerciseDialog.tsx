import { useId, useState } from 'react'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import { normalizeExerciseName } from '../../domain/exerciseNames'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { buttonClass, inputClass } from '../plans/styles'

/** Search the exercise catalog and pick the replacement. */
export function SwapExerciseDialog({
  catalog,
  currentId,
  onPick,
  onClose,
}: {
  catalog: ExerciseLocal[]
  currentId: string | null
  onPick(exercise: ExerciseLocal): void
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const titleId = useId()
  const key = normalizeExerciseName(query)
  const matches = catalog
    .filter((e) => e.id !== currentId)
    .filter((e) => key === '' || e.normalizedName.includes(key) || e.aliases.some((a) => normalizeExerciseName(a).includes(key)))
    .slice(0, 30)

  return (
    <div className="fixed inset-0 z-30 grid place-items-end bg-black/40 sm:place-items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid max-h-[85dvh] w-full max-w-lg gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Trocar exercício
        </h2>
        <input
          type="search"
          className={inputClass}
          aria-label="Buscar exercício"
          placeholder="Buscar no catálogo"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length === 0 ? (
          <p className="text-sm text-muted">Nenhum exercício encontrado.</p>
        ) : (
          <ul className="grid gap-2">
            {matches.map((e) => (
              <li key={e.id}>
                <button type="button" className={`${buttonClass} w-full text-left`} onClick={() => onPick(e)}>
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-2 text-xs text-muted">{muscleGroupLabel(e.primaryMuscleGroup)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={buttonClass} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
