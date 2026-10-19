import { useState } from 'react'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { ExerciseChangeLocal, SetKind, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise } from '../../domain/planDocuments'
import { buttonClass, inputClass } from '../plans/styles'
import { formatKg } from './format'
import { SetRow } from './SetRow'
import { SwapExerciseDialog } from './SwapExerciseDialog'
import { MAX_SET_INDEX } from './setInput'
import { restDurations } from './restDurations'

/** "80 kg × 10 · 80 × 9" */
function lastTimeText(sets: SetLocal[]): string {
  return sets.map((s, i) => (i === 0 ? `${formatKg(s.weightKg)} kg × ${s.reps}` : `${formatKg(s.weightKg)} × ${s.reps}`)).join(' · ')
}

function restText(planned: PlannedExercise): string | null {
  const durations = restDurations(planned)
  return durations ? `Descanso: ${durations.join(' / ')} s` : null
}

interface Props {
  planned: PlannedExercise
  /** The exercise being done (the planned one, or its replacement); null when it is not in the catalog yet. */
  exercise: ExerciseLocal | null
  change: ExerciseChangeLocal | undefined
  /** Sets of this planned exercise, for the exercise being done. */
  sets: SetLocal[]
  lastTime: SetLocal[] | undefined
  supersetName: string | null
  /** The catalog id of the planned exercise (null when it is not in the catalog). */
  plannedExerciseId: string | null
  catalog: ExerciseLocal[]
  onSaveSet(rowIndex: number, weightKg: number, reps: number, kind: SetKind): Promise<void>
  onUpdateSet(setId: string, weightKg: number, reps: number, kind: SetKind): Promise<void>
  onDeleteSet(setId: string): Promise<void>
  onSkip(note: string | null): Promise<void>
  /** Clears the skip: the card returns to the planned exercise. */
  onClearSkip(): Promise<void>
  onSwap(replacement: ExerciseLocal): Promise<void>
}

export function ExerciseCard(props: Props) {
  const { planned, exercise, change, sets, lastTime, supersetName, catalog } = props
  const [extra, setExtra] = useState(0)
  const [swapping, setSwapping] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState(false)
  const name = exercise?.name ?? planned.name
  const skipped = change?.action === 'skipped'
  const rest = restText(planned)

  const loggedAt = new Map(sets.map((s) => [s.setIndex, s]))
  const maxLogged = sets.reduce((m, s) => Math.max(m, s.setIndex), -1)
  // `extra` rows are added to the planned ones; sets logged beyond them keep their rows without growing the count.
  const rows = Math.min(MAX_SET_INDEX + 1, Math.max(planned.sets.length + extra, maxLogged + 1))

  /** Runs a write; a failure shows the inline error instead of an unhandled rejection. Returns whether it worked. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setActionError(false)
    try {
      await action()
      return true
    } catch (error) {
      console.error('could not save the change', error)
      setActionError(true)
      return false
    }
  }

  return (
    <section aria-label={name} className="grid gap-2 rounded-control border border-line bg-surface p-3">
      <header className="grid gap-0.5">
        <h2 className="text-base font-semibold">{name}</h2>
        {change?.action === 'swapped' && exercise && exercise.id !== props.plannedExerciseId && <p className="text-xs text-muted">Trocado de “{planned.name}”</p>}
        {planned.technique && <p className="text-sm text-muted">{planned.technique}</p>}
        {supersetName && <p className="text-sm text-muted">Bi-set com {supersetName}</p>}
        {rest && <p className="text-sm text-muted">{rest}</p>}
        {lastTime && lastTime.length > 0 && <p className="text-sm text-muted">Última vez: {lastTimeText(lastTime)}</p>}
      </header>

      {skipped ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-warn">Exercício pulado{change.note ? ` — ${change.note}` : ''}</p>
          <button type="button" className={buttonClass} onClick={() => void run(props.onClearSkip)}>
            Desfazer pulo
          </button>
        </div>
      ) : exercise === null ? (
        <p className="text-sm text-warn">Este exercício ainda não está no catálogo do aparelho. Sincronize ou troque por outro.</p>
      ) : (
        <ul className="grid gap-2">
          {Array.from({ length: rows }, (_, i) => (
            <SetRow
              // The exercise in the key resets the typed values when it is swapped.
              key={`${exercise.id}:${i}`}
              index={i}
              planned={planned.sets[i]}
              logged={loggedAt.get(i)}
              hint={lastTime?.[i]}
              onSave={(w, r, kind) => props.onSaveSet(i, w, r, kind)}
              onUpdate={(w, r, kind) => props.onUpdateSet(loggedAt.get(i)!.id, w, r, kind)}
              onDelete={() => props.onDeleteSet(loggedAt.get(i)!.id)}
            />
          ))}
        </ul>
      )}

      {!skipped && exercise !== null && rows < MAX_SET_INDEX + 1 && (
        <button type="button" className={buttonClass} onClick={() => setExtra((n) => n + 1)}>
          Adicionar série
        </button>
      )}

      {!skipped && !skipping && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => setSwapping(true)}>
            Trocar exercício
          </button>
          <button type="button" className={buttonClass} onClick={() => setSkipping(true)}>
            Pular exercício
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-danger">
          Não consegui salvar. Tente de novo.
        </p>
      )}

      {skipping && (
        <div className="grid gap-2 rounded-control border border-line p-2">
          <label className="grid gap-1 text-sm">
            Motivo (opcional)
            <input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                void run(() => props.onSkip(note.trim() === '' ? null : note.trim())).then((ok) => {
                  if (!ok) return
                  setSkipping(false)
                  setNote('')
                })
              }
            >
              Confirmar pulo
            </button>
            <button type="button" className={buttonClass} onClick={() => setSkipping(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {swapping && (
        <SwapExerciseDialog
          catalog={catalog}
          currentId={exercise?.id ?? null}
          onClose={() => setSwapping(false)}
          onPick={(e) => {
            setSwapping(false)
            void run(() => props.onSwap(e))
          }}
        />
      )}
    </section>
  )
}
