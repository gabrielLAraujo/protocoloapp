import { useState } from 'react'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import { MAX_EXERCISE_NOTE_LENGTH, type ExerciseChangeLocal, type SetKind, type SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise } from '../../domain/planDocuments'
import { buttonClass, inputClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { cardClasses } from '../../ui/styles'
import { Icon } from '../../ui/Icon'
import { formatKg } from './format'
import { SetRow } from './SetRow'
import { SwapExerciseDialog } from './SwapExerciseDialog'
import { MAX_SET_INDEX } from './setInput'
import { restDurations } from './restDurations'

/** "80 kg × 10 · 80 × 9" */
function lastTimeText(sets: SetLocal[]): string {
  return sets.map((s, i) => (i === 0 ? `${formatKg(s.weightKg)} kg × ${s.reps}` : `${formatKg(s.weightKg)} × ${s.reps}`)).join(' · ')
}

const KIND_LABEL: Record<SetKind, string> = { normal: 'normal', drop: 'drop', partial: 'parcial', rest_pause: 'rest-pause', warmup: 'aquecimento' }

function restText(planned: PlannedExercise): string | null {
  const durations = restDurations(planned)
  // A 0 in the sequence means "no rest after that set".
  return durations ? `Descanso: ${durations.map((n) => (n > 0 ? String(n) : '—')).join(' / ')} s` : null
}

interface Props {
  planned: PlannedExercise
  /** The exercise being done (the planned one, or its replacement); null when it is not in the catalog yet. */
  exercise: ExerciseLocal | null
  change: ExerciseChangeLocal | undefined
  /** Sets of this planned exercise, for the exercise being done. */
  sets: SetLocal[]
  lastTime: SetLocal[] | undefined
  /** Sets logged for this planned exercise under another exercise (the original, before a swap): shown read-only. */
  otherSets: { exerciseName: string; sets: SetLocal[] }[]
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
  /** The stored note of this planned exercise in the session ("" when none). */
  note: string
  /** Saves the note (a blank text clears it). */
  onSaveNote(text: string): Promise<void>
}

export function ExerciseCard(props: Props) {
  const { planned, exercise, change, sets, lastTime, supersetName, catalog } = props
  const [extra, setExtra] = useState(0)
  const [swapping, setSwapping] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [note, setNote] = useState('')
  const [exerciseNote, setExerciseNote] = useState(props.note)
  const [savedNote, setSavedNote] = useState(props.note)
  const [actionError, setActionError] = useState(false)
  const name = exercise?.name ?? planned.name
  const skipped = change?.action === 'skipped'
  const rest = restText(planned)

  const loggedAt = new Map(sets.map((s) => [s.setIndex, s]))
  const maxLogged = sets.reduce((m, s) => Math.max(m, s.setIndex), -1)
  // Sets logged beyond the planned rows keep their rows; "Adicionar série" always adds one on top of the rows shown
  // (also after a reload, when `extra` is back to 0 but extra sets are already logged).
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
    <section aria-label={name} className={cardClasses({ className: 'grid gap-3' })}>
      <header className="grid gap-1">
        <h2 className="text-lg font-bold tracking-tight">{name}</h2>
        {change?.action === 'swapped' && exercise && exercise.id !== props.plannedExerciseId && <p className="text-xs text-muted">Trocado de “{planned.name}”</p>}
        {planned.technique && <p className="text-sm text-muted">{planned.technique}</p>}
        {supersetName && <p className="text-sm text-muted">Bi-set com {supersetName}</p>}
        {rest && <p className="text-sm text-muted">{rest}</p>}
        {lastTime && lastTime.length > 0 && (
          <p className="text-sm text-muted">
            <Icon name="history" size={16} className="mr-1 inline-block align-[-3px]" />
            <span className="tabular-nums">Última vez: {lastTimeText(lastTime)}</span>
          </p>
        )}
      </header>

      {props.otherSets.map((group) => (
        <section key={group.exerciseName} aria-label={`Feitas em ${group.exerciseName}`} className="grid gap-1 rounded-control border border-line bg-raised p-3 text-sm">
          <h3 className="font-medium">Feitas em {group.exerciseName}</h3>
          <ul className="grid gap-1 text-muted">
            {group.sets.map((s) => (
              <li key={s.id}>
                Série {s.setIndex + 1}: {formatKg(s.weightKg)} kg × {s.reps}
                {s.kind === 'normal' ? '' : ` (${KIND_LABEL[s.kind]})`}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {skipped ? (
        <div className="grid gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-warn">
            <Icon name="skip" size={16} />
            <span>Exercício pulado{change.note ? ` — ${change.note}` : ''}</span>
          </p>
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
        <Button variant="ghost" icon="plus" className="justify-self-start" onClick={() => setExtra(rows + 1 - planned.sets.length)}>
          Adicionar série
        </Button>
      )}

      {!skipped && !skipping && (
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => setSwapping(true)}>
            Trocar exercício
          </Button>
          <Button size="sm" onClick={() => setSkipping(true)}>
            Pular exercício
          </Button>
        </div>
      )}

      <label className="grid gap-1 text-sm font-medium">
        Anotação
        <textarea
          className={`${inputClass} min-h-16`}
          rows={2}
          maxLength={MAX_EXERCISE_NOTE_LENGTH}
          value={exerciseNote}
          onChange={(e) => setExerciseNote(e.target.value)}
          onBlur={() => {
            if (exerciseNote.trim() === savedNote.trim()) return
            const text = exerciseNote.trim()
            void run(() => props.onSaveNote(text)).then((ok) => {
              if (ok) setSavedNote(text)
            })
          }}
        />
      </label>

      {actionError && (
        <p role="alert" className="text-sm text-danger">
          Não consegui salvar. Tente de novo.
        </p>
      )}

      {skipping && (
        <div className="grid gap-3 rounded-control border border-line bg-raised p-3">
          <label className="grid gap-1 text-sm font-medium">
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
