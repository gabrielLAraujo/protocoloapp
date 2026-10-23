import { useState } from 'react'
import { saveLoggedSession } from '../../data/adherenceLinks'
import type { Data } from '../../data/dataContext'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import type { SessionLocal, SetLocal } from '../../data/workoutRepo'
import type { PlannedExercise, WorkoutDay } from '../../domain/planDocuments'
import { buttonClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { ACTION_ROW, cardClasses } from '../../ui/styles'
import { DiscardSession } from './DiscardSession'
import { ExerciseCard } from './ExerciseCard'
import { RestTimerBar } from './RestTimerBar'
import { useActiveSession } from './useActiveSession'
import { useRestTimer } from './useRestTimer'
import { bisetNext, dayBlocks, restAfterSet, type FlowExercise, type RestDecision } from './sessionFlow'
import { findExercise } from './workoutPlans'
import { formatShortDate } from './format'

const DISMISSED_KEY = 'protocolo.dismissedSubSets'

/** localStorage may be missing or throw (private mode): the removed rows then just come back after a reload. */
function loadDismissed(sessionId: string): ReadonlySet<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? 'null') as { sessionId?: unknown; keys?: unknown } | null
    if (stored?.sessionId !== sessionId || !Array.isArray(stored.keys)) return new Set()
    return new Set(stored.keys.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function saveDismissed(sessionId: string, keys: ReadonlySet<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ sessionId, keys: [...keys] }))
  } catch {
    // Best effort.
  }
}

/**
 * The workout in progress: planned exercises with their set rows, the rest timer bar and "Finalizar treino". In `log`
 * mode (a workout of an earlier day, or one corrected from the history) there is no rest timer: the sets are typed in,
 * edited or removed, and "Salvar treino" ends the session on its day (saveLoggedSession).
 */
export function SessionView({
  data,
  session,
  day,
  catalog,
  mode = 'live',
  onFinished,
  onDiscarded,
}: {
  data: Data
  session: SessionLocal
  day: WorkoutDay
  catalog: ExerciseLocal[]
  mode?: 'live' | 'log'
  onFinished(): void
  /** The empty session was discarded. */
  onDiscarded(): void
}) {
  const timer = useRestTimer(session.id)
  const [confirming, setConfirming] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sub-set rows the user removed ("Remover"), kept on the device for this session (like the rest timer).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => loadDismissed(session.id))

  const effective = (planned: PlannedExercise, active: ReturnType<typeof useActiveSession>) => {
    const change = active.changes.get(planned.key)
    if (change?.action === 'swapped' && change.replacementExerciseId) {
      return { change, exercise: catalog.find((e) => e.id === change.replacementExerciseId) ?? null }
    }
    return { change, exercise: findExercise(catalog, planned) }
  }

  const logging = mode === 'log'
  const active = useActiveSession(
    data,
    session.id,
    day.exercises.map((p) => findExercise(catalog, p)?.id).filter((id): id is string => !!id),
    logging ? session.startedAt : undefined,
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
    if (logging) return
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
          saveDismissed(session.id, hidden)
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

  async function saveLog() {
    setFinishing(true)
    setError(null)
    try {
      await saveLoggedSession(data.db, data.userId, session.id, new Date())
      onFinished()
    } catch (e) {
      console.error('could not save the logged session', e)
      setError('Não foi possível salvar o treino.')
      setFinishing(false)
    }
  }

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
    <div className="grid gap-4" style={timer.visible && !logging ? { paddingBottom: '6rem' } : undefined}>
      <header className="grid gap-1 pb-2">
        <h1 className="text-xl font-bold">
          {day.name}
          {day.notes ? ` — ${day.notes}` : ''}
        </h1>
        {logging ? (
          <p className="text-sm font-semibold text-muted tabular-nums">Registro do treino de {formatShortDate(session.date)}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-ink" />
            Treino em andamento
          </p>
        )}
      </header>

      {dayBlocks(day, active.changes, (p) => effective(p, active).exercise !== null).map((block) => {
        if (block.type === 'single') return card(block.planned, { pairEndedWith: block.endedWith })
        const a = flowOf(block.a, active.sets)
        const b = flowOf(block.b, active.sets)
        const next = bisetNext(a, b, dismissed)
        const nextName = next ? (next.which === 'a' ? a.name : b.name) : null
        return (
          <section
            key={`${block.a.key}+${block.b.key}`}
            aria-label={`Bi-set: ${a.name} + ${b.name}`}
            className="grid gap-3 rounded-card border border-ink/20 bg-raised p-2"
          >
            <header className="grid gap-1 px-2 pt-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
                Bi-set
              </h2>
              <p role="status" className="text-base font-medium text-ink">
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
      {logging ? (
        <Button variant="primary" size="lg" icon="check" loading={finishing} onClick={() => void saveLog()}>
          Salvar treino
        </Button>
      ) : confirming ? (
        <div role="group" aria-label="Confirmar finalização" className={cardClasses({ className: 'grid gap-3' })}>
          <p className="text-lg font-semibold">Finalizar o treino agora?</p>
          <div className={ACTION_ROW}>
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

      {!logging && <RestTimerBar timer={timer} />}
    </div>
  )
}
