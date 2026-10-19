import { useState } from 'react'
import type { Data } from '../../data/dataContext'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise, WorkoutDay } from '../../domain/planDocuments'
import { buttonClass } from '../plans/styles'
import { DiscardSession } from './DiscardSession'
import { ExerciseCard } from './ExerciseCard'
import { RestTimerBar } from './RestTimerBar'
import { useActiveSession } from './useActiveSession'
import { useRestTimer } from './useRestTimer'
import { restDurations } from './restDurations'
import { findExercise } from './workoutPlans'

/** The workout in progress: planned exercises with their set rows, the rest timer bar and "Finalizar treino". */
export function SessionView({
  data,
  session,
  day,
  catalog,
  onFinished,
  onDiscarded,
}: {
  data: Data
  session: SessionLocal
  day: WorkoutDay
  catalog: ExerciseLocal[]
  onFinished(): void
  /** The empty session was discarded. */
  onDiscarded(): void
}) {
  const timer = useRestTimer(session.id)
  const [confirming, setConfirming] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effective = (planned: PlannedExercise, active: ReturnType<typeof useActiveSession>) => {
    const change = active.changes.get(planned.key)
    if (change?.action === 'swapped' && change.replacementExerciseId) {
      return { change, exercise: catalog.find((e) => e.id === change.replacementExerciseId) ?? null }
    }
    return { change, exercise: findExercise(catalog, planned) }
  }

  const active = useActiveSession(
    data,
    session.id,
    day.exercises.map((p) => findExercise(catalog, p)?.id).filter((id): id is string => !!id),
  )

  if (active.failed) return <p role="alert">Não foi possível abrir o treino no aparelho.</p>
  if (!active.ready) return <p className="text-muted">Carregando o treino…</p>

  async function finish() {
    setFinishing(true)
    setError(null)
    try {
      await active.finish()
      timer.skip()
      onFinished()
    } catch (e) {
      console.error('could not finish the session', e)
      setError('Não foi possível finalizar o treino.')
      setFinishing(false)
    }
  }

  return (
    <div className="grid gap-3" style={timer.visible ? { paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' } : undefined}>
      <h1 className="text-xl font-semibold">
        {day.name}
        {day.notes ? ` — ${day.notes}` : ''}
      </h1>
      <p className="text-sm text-muted">Treino em andamento</p>

      {day.exercises.map((planned) => {
        const { change, exercise } = effective(planned, active)
        const setsHere = active.sets.filter((s) => s.plannedExerciseKey === planned.key && s.exerciseId === exercise?.id)
        const originalId = findExercise(catalog, planned)?.id
        // Sets of this planned exercise that were logged before a swap stay visible, grouped by the exercise they were done in.
        const otherByExercise = new Map<string, SetLocal[]>()
        for (const s of active.sets) {
          if (s.plannedExerciseKey !== planned.key || s.exerciseId === exercise?.id) continue
          otherByExercise.set(s.exerciseId, [...(otherByExercise.get(s.exerciseId) ?? []), s])
        }
        const otherSets = [...otherByExercise].map(([id, sets]) => ({
          exerciseName: catalog.find((e) => e.id === id)?.name ?? 'outro exercício',
          sets: sets.sort((a, b) => a.setIndex - b.setIndex),
        }))
        return (
          <ExerciseCard
            key={planned.key}
            planned={planned}
            exercise={exercise}
            change={change}
            sets={setsHere}
            lastTime={exercise ? active.lastTime.get(exercise.id) : undefined}
            otherSets={otherSets}
            note={session.exerciseNotes[planned.key] ?? ''}
            onSaveNote={(text) => active.saveExerciseNote(planned.key, text)}
            plannedExerciseId={originalId ?? null}
            supersetName={planned.supersetWith ? (day.exercises.find((p) => p.key === planned.supersetWith)?.name ?? null) : null}
            catalog={catalog}
            onSaveSet={async (rowIndex, weightKg, reps, kind) => {
              if (!exercise) return
              await active.logSet({ exerciseId: exercise.id, plannedExerciseKey: planned.key, setIndex: rowIndex, weightKg, reps, kind })
              // A 0 in the sequence means no rest after that set.
              const durations = restDurations(planned)
              if (durations && durations[Math.min(setsHere.length, durations.length - 1)]! > 0) timer.start(durations, setsHere.length, exercise.name)
            }}
            onUpdateSet={active.updateSet}
            onDeleteSet={active.removeSet}
            onSkip={(note) => active.skipExercise(planned.key, note)}
            onClearSkip={() => active.clearChange(planned.key)}
            onSwap={(replacement) => active.swapExercise(planned.key, replacement.id)}
          />
        )
      })}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {confirming ? (
        <div role="group" aria-label="Confirmar finalização" className="grid gap-2 rounded-control border border-line p-3">
          <p className="font-medium">Finalizar o treino agora?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={finishing}
              onClick={() => void finish()}
              className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              Sim, finalizar
            </button>
            <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
              Continuar treinando
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-12 rounded-control bg-accent px-4 text-base font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Finalizar treino
        </button>
      )}

      {active.sets.length === 0 && <DiscardSession data={data} sessionId={session.id} onDiscarded={onDiscarded} />}

      <RestTimerBar timer={timer} />
    </div>
  )
}
