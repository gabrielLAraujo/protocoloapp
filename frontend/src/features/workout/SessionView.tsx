import { useState } from 'react'
import type { Data } from '../../data/dataContext'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise, WorkoutDay } from '../../domain/planDocuments'
import { buttonClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { cardClasses } from '../../ui/styles'
import { DiscardSession } from './DiscardSession'
import { ExerciseCard } from './ExerciseCard'
import { RestTimerBar } from './RestTimerBar'
import { useActiveSession } from './useActiveSession'
import { useRestTimer } from './useRestTimer'
import { bisetNext, dayBlocks, restAfterSet, type FlowExercise, type RestDecision } from './sessionFlow'
import { Icon } from '../../ui/Icon'
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
  // Sub-set rows the user removed ("Remover"): kept for this screen only; a reload shows them again, empty.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())

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

  /** The exercise being done for a planned one, with its sets in this session. */
  const flowOf = (planned: PlannedExercise, sets: SetLocal[]): FlowExercise => {
    const { exercise } = effective(planned, active)
    return {
      planned,
      sets: sets.filter((s) => s.plannedExerciseKey === planned.key && s.exerciseId === exercise?.id),
      name: exercise?.name ?? planned.name,
    }
  }

  function applyRest(decision: RestDecision) {
    if (decision.kind === 'rest') timer.start(decision.durations, decision.index, decision.label)
    else if (decision.kind === 'skip') timer.skip()
  }

  function card(planned: PlannedExercise, options: { partner?: PlannedExercise; biset?: { letter: 'A' | 'B'; next: boolean }; pairEndedWith?: string | null }) {
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
    /** After a write: the rest the techniques and the bi-set call for. */
    const restAfter = (fresh: SetLocal[], parentId: string, hidden: ReadonlySet<string>) =>
      restAfterSet({
        exercise: flowOf(planned, fresh),
        partner: options.partner ? flowOf(options.partner, fresh) : null,
        parentId,
        dismissed: hidden,
      })
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
        pairEndedWith={options.pairEndedWith ?? null}
        biset={options.biset}
        catalog={catalog}
        dismissed={dismissed}
        onDismissSlot={(key) => {
          const hidden = new Set(dismissed).add(key)
          setDismissed(hidden)
          // Not doing the last sub-set ends the set: its rest starts.
          const decision = restAfter(active.sets, key.split(':')[0]!, hidden)
          if (decision.kind === 'rest') applyRest(decision)
        }}
        onSaveSet={async (rowIndex, weightKg, reps, kind) => {
          if (!exercise) return
          const fresh = await active.logSet({ exerciseId: exercise.id, plannedExerciseKey: planned.key, setIndex: rowIndex, weightKg, reps, kind })
          const stored = fresh
            .filter((s) => s.plannedExerciseKey === planned.key && s.exerciseId === exercise.id && s.parentSetId === null && s.setIndex === rowIndex)
            .at(-1)
          if (stored) applyRest(restAfter(fresh, stored.id, dismissed))
        }}
        onSaveSubSet={async (parent, slot, weightKg, reps) => {
          const fresh = await active.logSubSet({ parentSetId: parent.id, kind: slot.kind, ordinal: slot.ordinal, weightKg, reps })
          applyRest(restAfter(fresh, parent.id, dismissed))
        }}
        onUpdateSet={active.updateSet}
        onDeleteSet={active.removeSet}
        onSkip={(note) => active.skipExercise(planned.key, note)}
        onClearSkip={() => active.clearChange(planned.key)}
        onSwap={(replacement) => active.swapExercise(planned.key, replacement.id)}
      />
    )
  }

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
    <div className="grid gap-4" style={timer.visible ? { paddingBottom: '6rem' } : undefined}>
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {day.name}
          {day.notes ? ` — ${day.notes}` : ''}
        </h1>
        <p className="flex items-center gap-2 text-sm font-medium text-accent">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          Treino em andamento
        </p>
      </div>

      {dayBlocks(day, active.changes).map((block) => {
        if (block.type === 'single') return card(block.planned, { pairEndedWith: block.endedWith })
        const a = flowOf(block.a, active.sets)
        const b = flowOf(block.b, active.sets)
        const next = bisetNext(a, b, dismissed)
        const nextName = next ? (next.which === 'a' ? a.name : b.name) : null
        return (
          <section
            key={`${block.a.key}+${block.b.key}`}
            aria-label={`Bi-set: ${a.name} + ${b.name}`}
            className="grid gap-3 rounded-card border-2 border-accent/40 bg-accent-soft p-2"
          >
            <header className="grid gap-0.5 px-2 pt-1">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-accent uppercase">
                <Icon name="swap" size={16} />
                Bi-set
              </h2>
              <p role="status" className="text-sm font-medium">
                {next
                  ? `Próximo: ${next.which.toUpperCase()} · ${nextName} — ${
                      next.slot ? `${next.slot.kind === 'drop' ? 'drop' : 'rest-pause'} ${next.slot.ordinal} da série ${next.setNumber}` : `série ${next.setNumber}`
                    }`
                  : 'Bi-set concluído'}
              </p>
              <p className="text-xs text-muted">Alterne A e B; o descanso vem depois do par.</p>
            </header>
            {card(block.a, { partner: block.b, biset: { letter: 'A', next: next?.which === 'a' } })}
            {card(block.b, { partner: block.a, biset: { letter: 'B', next: next?.which === 'b' } })}
          </section>
        )
      })}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {confirming ? (
        <div role="group" aria-label="Confirmar finalização" className={cardClasses({ className: 'grid gap-3' })}>
          <p className="font-semibold">Finalizar o treino agora?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={finishing} onClick={() => void finish()}>
              Sim, finalizar
            </Button>
            <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
              Continuar treinando
            </button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="lg" icon="check" onClick={() => setConfirming(true)}>
          Finalizar treino
        </Button>
      )}

      {active.sets.length === 0 && <DiscardSession data={data} sessionId={session.id} onDiscarded={onDiscarded} />}

      <RestTimerBar timer={timer} />
    </div>
  )
}
