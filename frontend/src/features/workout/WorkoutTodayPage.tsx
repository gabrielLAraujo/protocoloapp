import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { finishSessionAndMark } from '../../data/adherenceLinks'
import { useData, type Data } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { rotationOverrideRepo, type RotationOverrideLocal } from '../../data/rotationOverrideRepo'
import { workoutRepo, type SessionLocal } from '../../data/workoutRepo'
import { OFF, type WorkoutDay } from '../../domain/planDocuments'
import { activePlanAt, resolveDay } from '../../domain/rotation'
import { useSync } from '../sync/syncContext'
import { buttonClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { buttonClasses } from '../../ui/styles'
import { cardClasses } from '../../ui/styles'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { formatShortDate, repsLabel } from './format'
import { DiscardSession } from './DiscardSession'
import { FinishSummary } from './FinishSummary'
import { SessionView } from './SessionView'
import { useToday } from './useToday'
import { loadWorkoutPlans, type WorkoutPlanEntry } from './workoutPlans'

interface Loaded {
  plans: WorkoutPlanEntry[]
  overrides: RotationOverrideLocal[]
  catalog: ExerciseLocal[]
  open: SessionLocal | null
  /** A session of today that was already finished and has at least one working set. */
  doneToday: boolean
  /** The open session has live sets (an empty one can be discarded). */
  openHasSets: boolean
}

const primaryClass = buttonClasses({ variant: 'primary', size: 'lg' })

const now = () => new Date()

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

async function load(db: Data['db'], today: string): Promise<Loaded> {
  const [plans, overrides, catalog, open, sessionsToday] = await Promise.all([
    loadWorkoutPlans(db),
    rotationOverrideRepo.between(db, '0000-01-01', '9999-12-31'),
    exerciseRepo.all(db),
    workoutRepo.openSession(db),
    workoutRepo.sessionsBetween(db, today, today),
  ])
  const finishedToday = sessionsToday.filter((s) => s.endedAt !== null)
  const [finishedSets, openSets] = await Promise.all([
    Promise.all(finishedToday.map((s) => workoutRepo.setsForSession(db, s.id))),
    open ? workoutRepo.setsForSession(db, open.id) : Promise.resolve([]),
  ])
  // An empty (or warm-up only) session is not a workout done.
  const doneToday = finishedSets.some((sets) => sets.some((s) => s.kind !== 'warmup'))
  return { plans, overrides, catalog, open, doneToday, openHasSets: openSets.length > 0 }
}

/** `/treino`: today's workout (or rest), the session in progress and the finish summary. */
export function WorkoutTodayPage() {
  const data = useData()
  const { dataVersion } = useSync()
  const today = useToday()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [summary, setSummary] = useState<{ sessionId: string; date: string } | null>(null)
  // An open session from a previous day is only resumed when the user says so.
  const [resumeOld, setResumeOld] = useState(false)
  // The session being shown stays on screen when midnight passes mid-workout (its date is then "yesterday").
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!data) return
    const result = await load(data.db, today)
    if (result.open?.date === today) setLiveSessionId(result.open.id)
    setLoaded(result)
  }, [data, today])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    load(data.db, today)
      .then((result) => {
        if (cancelled) return
        if (result.open?.date === today) setLiveSessionId(result.open.id)
        setLoaded(result)
      })
      .catch((error: unknown) => {
        console.error('could not read the workout', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (!loaded) return <Message>Carregando…</Message>

  if (summary) {
    return (
      <FinishSummary
        data={data}
        sessionId={summary.sessionId}
        date={summary.date}
        catalog={loaded.catalog}
        onDone={() => {
          setSummary(null)
          void reload()
        }}
      />
    )
  }

  const { open } = loaded
  if (open && (open.date === today || resumeOld || open.id === liveSessionId)) {
    const day = loaded.plans.find((p) => p.id === open.planVersionId)?.document.days.find((d) => d.key === open.dayKey)
    if (!day) {
      return (
        <div className="grid gap-3">
          <p role="alert">Não encontrei o treino desta sessão na ficha. Você pode encerrá-la.</p>
          <EndOpenSession data={data} session={open} onEnded={reload} />
        </div>
      )
    }
    return (
      <SessionView
        key={open.id}
        data={data}
        session={open}
        day={day}
        catalog={loaded.catalog}
        onDiscarded={() => {
          setResumeOld(false)
          setLiveSessionId(null)
          void reload()
        }}
        onFinished={() => {
          setResumeOld(false)
          setLiveSessionId(null)
          setSummary({ sessionId: open.id, date: open.date })
          void reload()
        }}
      />
    )
  }
  if (open) {
    return (
      <div className="grid gap-3">
        <h1 className="text-xl font-bold tracking-tight">Treino</h1>
        <p role="alert" className={cardClasses({ tone: 'warn', padding: 'sm', className: 'font-medium' })}>
          Você tem um treino aberto de {formatShortDate(open.date)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryClass} onClick={() => setResumeOld(true)}>
            Continuar
          </button>
          <EndOpenSession data={data} session={open} onEnded={reload} />
        </div>
        {!loaded.openHasSets && <DiscardSession data={data} sessionId={open.id} onDiscarded={() => void reload()} />}
      </div>
    )
  }

  return <TodayPlan data={data} today={today} loaded={loaded} onChanged={reload} onStarted={reload} />
}

/** "Encerrar": finishes an open session at its last set (or its start when it has no sets). */
function EndOpenSession({ data, session, onEnded }: { data: Data; session: SessionLocal; onEnded(): Promise<void> }) {
  const { syncNow } = useSync()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function end() {
    setBusy(true)
    setError(false)
    try {
      const sets = await workoutRepo.setsForSession(data.db, session.id)
      const last = sets.reduce((max, s) => (s.completedAt > max ? s.completedAt : max), session.startedAt)
      await finishSessionAndMark(data.db, data.userId, session.id, new Date(last), now())
      void syncNow()
      await onEnded()
    } catch (e) {
      console.error('could not end the session', e)
      setError(true)
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void end()}>
        Encerrar
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          Não foi possível encerrar o treino.
        </p>
      )}
    </>
  )
}

function TodayPlan({ data, today, loaded, onChanged, onStarted }: { data: Data; today: string; loaded: Loaded; onChanged(): Promise<void>; onStarted(): Promise<void> }) {
  const { syncNow } = useSync()
  const [swapping, setSwapping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = resolveDay(
    today,
    loaded.plans.map((p) => p.at),
    loaded.overrides,
  )
  const plan = loaded.plans.find((p) => p.id === (resolved.kind === 'workout' ? resolved.planVersionId : activePlanAt(today, loaded.plans.map((e) => e.at))?.planVersionId))
  const day: WorkoutDay | undefined = resolved.kind === 'workout' ? plan?.document.days.find((d) => d.key === resolved.dayKey) : undefined

  if (loaded.plans.length === 0 || resolved.kind === 'none') {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-bold tracking-tight">Treino</h1>
        <EmptyState
          icon="dumbbell"
          action={
            <Link to="/planejamento" className={buttonClasses({ variant: 'primary' })}>
              Ir para o Planejamento
            </Link>
          }
        >
          {loaded.plans.length === 0 ? 'Nenhuma ficha de treino ativa.' : 'Não há treino definido para hoje.'}
        </EmptyState>
        <HistoryLink />
      </div>
    )
  }

  async function choose(dayKey: string) {
    setBusy(true)
    setError(null)
    try {
      await rotationOverrideRepo.set(data.db, data.userId, today, dayKey, now())
      void syncNow()
      setSwapping(false)
      await onChanged()
    } catch (e) {
      console.error('could not save the override', e)
      setError('Não foi possível trocar o treino de hoje.')
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (resolved.kind !== 'workout') return
    setBusy(true)
    setError(null)
    try {
      await workoutRepo.startSession(data.db, data.userId, { date: today, planVersionId: resolved.planVersionId, dayKey: resolved.dayKey }, now())
      void syncNow()
      await onStarted()
    } catch (e) {
      console.error('could not start the session', e)
      setError('Não foi possível começar o treino.')
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {resolved.kind === 'off' ? (
        <h1 className="text-xl font-bold tracking-tight">Hoje é descanso</h1>
      ) : (
        <h1 className="text-xl font-bold tracking-tight">
          {day ? day.name : resolved.dayKey}
          {day?.notes ? ` — ${day.notes}` : ''}
        </h1>
      )}
      {loaded.doneToday && (
        <p className="flex items-center gap-2 text-sm font-medium text-ok">
          <Icon name="check" size={18} strokeWidth={2.4} />
          Você já concluiu um treino hoje.
        </p>
      )}

      {resolved.kind === 'workout' && day && (
        <>
          <ol aria-label="Exercícios do dia" className={cardClasses({ padding: 'none', className: 'grid divide-y divide-line' })}>
            {day.exercises.map((e, i) => (
              <li key={e.key} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold tabular-nums text-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 font-medium">{e.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-muted">
                  {e.sets.length} × {e.sets[0] ? repsLabel(e.sets[0].repsMin, e.sets[0].repsMax) : '—'}
                </span>
              </li>
            ))}
          </ol>
          <Button variant="primary" size="lg" icon="dumbbell" disabled={busy} onClick={() => void start()}>
            Começar treino
          </Button>
        </>
      )}
      {resolved.kind === 'workout' && !day && <p role="alert">Este treino não existe mais na ficha. Troque o treino de hoje.</p>}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {swapping && plan ? (
        <section aria-label="Trocar o treino de hoje" className={cardClasses({ className: 'grid gap-3' })}>
          <h2 className="text-base font-semibold">Trocar o treino de hoje</h2>
          <ul className="grid gap-2">
            {plan.document.days.map((d) => (
              <li key={d.key}>
                <button type="button" className={`${buttonClass} w-full justify-start! text-left`} disabled={busy} onClick={() => void choose(d.key)}>
                  {d.name}
                  {d.notes ? ` — ${d.notes}` : ''}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className={`${buttonClass} w-full justify-start! text-left`} disabled={busy} onClick={() => void choose(OFF)}>
                Descanso
              </button>
            </li>
          </ul>
          <Button variant="ghost" onClick={() => setSwapping(false)}>
            Cancelar
          </Button>
        </section>
      ) : (
        <Button icon="swap" onClick={() => setSwapping(true)}>
          Trocar o treino de hoje
        </Button>
      )}
      <HistoryLink />
    </div>
  )
}

const HistoryLink = () => (
  <Link to="/treino/historico" className={buttonClasses({ variant: 'ghost', className: 'w-fit -ml-2' })}>
    <Icon name="history" size={18} />
    Histórico de treinos
  </Link>
)
