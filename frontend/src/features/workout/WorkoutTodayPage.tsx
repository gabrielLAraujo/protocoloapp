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
import { ACTION_ROW, buttonClasses, cardClasses } from '../../ui/styles'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'
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
/** One choice of the "Trocar o treino de hoje" list: a full-width row of a list card. */
const optionClass =
  'flex min-h-13 w-full items-center px-4 py-2.5 text-left text-base hover:bg-raised active:bg-raised disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

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
      <div className={NARROW}>
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
      </div>
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
      <div className={NARROW}>
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
      </div>
    )
  }
  if (open) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-bold">Treino</h1>
        <p role="alert" className={cardClasses({ tone: 'warn', className: 'font-medium' })}>
          Você tem um treino aberto de {formatShortDate(open.date)}
        </p>
        <div className={ACTION_ROW}>
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

/** The session and its summary are one column on the desktop too (/treino itself is a wide screen). */
const NARROW = 'lg:mx-auto lg:max-w-[760px]'

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
      <div className="grid gap-6">
        <h1 className="text-xl font-bold">Treino</h1>
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
    <div className="grid gap-6">
      <header className="grid gap-1">
        {resolved.kind === 'off' ? (
          <h1 className="text-xl font-bold">Hoje é descanso</h1>
        ) : (
          <h1 className="text-xl font-bold">
            {day ? day.name : resolved.dayKey}
            {day?.notes ? ` — ${day.notes}` : ''}
          </h1>
        )}
        {resolved.kind === 'workout' && day && (
          <p className="text-sm text-muted tabular-nums">
            {day.exercises.length} {day.exercises.length === 1 ? 'exercício' : 'exercícios'},{' '}
            {day.exercises.reduce((n, e) => n + e.sets.length, 0)} séries
          </p>
        )}
        {loaded.doneToday && (
          <p className="flex items-center gap-2 pt-1 text-sm font-medium text-ink">
            <Icon name="check" size={18} strokeWidth={2.4} />
            Você já concluiu um treino hoje.
          </p>
        )}
      </header>

      {/* Desktop: the exercises on the left, the actions and the history on the right. */}
      <div className={`grid gap-6 ${resolved.kind === 'workout' ? 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8' : ''}`}>
        {resolved.kind === 'workout' && day && (
          <ol aria-label="Exercícios do dia" className={cardClasses({ tone: 'list' })}>
            {day.exercises.map((e, i) => (
              <li key={e.key}>
                <ListRow
                  leading={i + 1}
                  title={e.name}
                  value={
                    <span className="text-sm text-muted">
                      {e.sets.length} × {e.sets[0] ? repsLabel(e.sets[0].repsMin, e.sets[0].repsMax) : '—'}
                    </span>
                  }
                />
              </li>
            ))}
          </ol>
        )}
        {resolved.kind === 'workout' && !day && <p role="alert">Este treino não existe mais na ficha. Troque o treino de hoje.</p>}

        <div className="grid gap-6 lg:sticky lg:top-10">
          {resolved.kind === 'workout' && day && (
            <Button variant="primary" size="lg" icon="dumbbell" disabled={busy} onClick={() => void start()}>
              Começar treino
            </Button>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {swapping && plan ? (
            <section aria-label="Trocar o treino de hoje" className="grid gap-1">
              <SectionHeader title="Trocar o treino de hoje" />
              <ul className={cardClasses({ tone: 'list' })}>
                {plan.document.days.map((d) => (
                  <li key={d.key}>
                    <button type="button" className={optionClass} disabled={busy} onClick={() => void choose(d.key)}>
                      <span className="font-medium text-ink">{d.name}</span>
                      {d.notes ? <span className="text-muted">{` — ${d.notes}`}</span> : null}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className={optionClass} disabled={busy} onClick={() => void choose(OFF)}>
                    <span className="font-medium text-ink">Descanso</span>
                  </button>
                </li>
              </ul>
              <Button variant="ghost" className="mt-2" onClick={() => setSwapping(false)}>
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
      </div>
    </div>
  )
}

const HistoryLink = () => (
  <Link to="/treino/historico" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
    <Icon name="history" size={18} />
    Histórico de treinos
  </Link>
)
