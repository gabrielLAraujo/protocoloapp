import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useData, type Data } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { planRepo } from '../../data/planRepo'
import { rotationOverrideRepo, type RotationOverrideLocal } from '../../data/rotationOverrideRepo'
import { updateCycleRepo } from '../../data/updateCycleRepo'
import { workoutRepo, type SessionSummary, type SetLocal } from '../../data/workoutRepo'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { parseProtocolDocument } from '../../domain/planDocuments'
import { localDate } from '../checkin/localDate'
import { CycleCalendar } from '../summary/CycleCalendar'
import type { SummaryInput } from '../summary/summaryData'
import { useSync } from '../sync/syncContext'
import { E1rmChart } from '../workout/E1rmChart'
import { formatDate, formatVolume } from '../workout/format'
import { useToday } from '../workout/useToday'
import { loadWorkoutPlans, type WorkoutPlanEntry } from '../workout/workoutPlans'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Chip } from '../../ui/Chip'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'
import { cardClasses } from '../../ui/styles'
import { DaySwap } from './DaySwap'
import type { TrainingNotice } from './SessionPage'
import { buildTrainingStats, trainingPeriod, type TrainingStats } from './trainingStats'
import { WeekBars } from './WeekBars'

const PAGE_SIZE = 60

interface Loaded {
  plans: WorkoutPlanEntry[]
  overrides: RotationOverrideLocal[]
  stats: TrainingStats
  history: SessionSummary[]
  hasMore: boolean
  /** Exercises with at least one set, for the exercise list under the history. */
  exercises: ExerciseLocal[]
  /** plan version id -> day key -> day name */
  dayNames: Map<string, Map<string, string>>
}

/** The active protocol as the summary reads it (its cycle closes once its update is sent). */
async function loadProtocol(db: Data['db']): Promise<SummaryInput['protocol']> {
  const [active, updateCycle] = await Promise.all([planRepo.getActive(db, 'protocol'), updateCycleRepo.current(db)])
  if (!active?.activatedAt) return null
  const parsed = parseProtocolDocument(active.document)
  if (!parsed.ok) return null
  const sent = updateCycle?.status === 'sent' && updateCycle.sentAt && updateCycle.protocolVersionId === active.id ? updateCycle.sentAt : null
  return { activatedOn: localDate(new Date(active.activatedAt)), document: parsed.value, updateSentOn: sent ? localDate(new Date(sent)) : null }
}

async function load(db: Data['db'], today: string): Promise<Loaded> {
  const [plans, overrides, protocol, catalog, page, doneIds] = await Promise.all([
    loadWorkoutPlans(db),
    // Overrides re-anchor the rotation cumulatively from each version's activation (see rotation.ts): load them all.
    rotationOverrideRepo.between(db, '0000-01-01', '9999-12-31'),
    loadProtocol(db),
    exerciseRepo.all(db),
    // One aggregate query for the history (+1 row to know whether there are more).
    workoutRepo.sessionSummaries(db, PAGE_SIZE + 1, 0),
    workoutRepo.exerciseIdsWithSets(db),
  ])
  const { from, statsTo } = trainingPeriod(protocol, today)
  const sessions = from <= statsTo ? await workoutRepo.sessionsBetween(db, from, statsTo) : []
  const sets: SetLocal[] = (await Promise.all(sessions.map((s) => workoutRepo.setsForSession(db, s.id)))).flat()
  const stats = buildTrainingStats({ protocol, plans: plans.map((p) => p.at), overrides, sessions, sets, exercises: catalog }, today)
  const done = new Set(doneIds)
  return {
    plans,
    overrides,
    stats,
    history: page.slice(0, PAGE_SIZE),
    hasMore: page.length > PAGE_SIZE,
    exercises: catalog.filter((e) => done.has(e.id)),
    dayNames: new Map(plans.map((p) => [p.id, new Map(p.document.days.map((d) => [d.key, d.name]))])),
  }
}

/**
 * `/treino`, only to look things up (workouts are logged in Hevy): today's planned day with its swap, the workouts done
 * and planned per week, the cycle calendar, the load of the most trained exercises and every session, newest first.
 */
export function TrainingPage() {
  const data = useData()
  const today = useToday()
  const { dataVersion } = useSync()
  const location = useLocation()
  const [notice] = useState(() => (location.state as TrainingNotice | null)?.notice ?? null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const reload = useCallback(async () => {
    if (!data) return
    setLoaded(await load(data.db, today))
  }, [data, today])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    load(data.db, today).then(
      (result) => {
        if (!cancelled) setLoaded(result)
      },
      (error: unknown) => {
        console.error('could not read the workouts', error)
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
    // A finished sync can bring new sessions from Hevy; reload then.
  }, [data, today, dataVersion])

  async function loadMore() {
    if (!data || !loaded || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await workoutRepo.sessionSummaries(data.db, PAGE_SIZE + 1, loaded.history.length)
      setLoaded({ ...loaded, history: [...loaded.history, ...page.slice(0, PAGE_SIZE)], hasMore: page.length > PAGE_SIZE })
    } catch (error) {
      console.error('could not read more history', error)
      setFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  const { stats } = loaded
  const dayName = (s: SessionSummary['session']) => loaded.dayNames.get(s.planVersionId)?.get(s.dayKey) ?? s.dayKey

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-bold tracking-tight">Treino</h1>
        <DaySwap data={data} today={today} plans={loaded.plans} overrides={loaded.overrides} onChanged={reload} />
        {notice && (
          <p role="status" className="flex items-center gap-2 pt-1 text-sm font-medium text-ink">
            <Icon name="check" size={18} strokeWidth={2.4} />
            {notice}
          </p>
        )}
      </header>

      {/*
        Desktop: the charts on the left, the history on the right. On the phone both columns are `display: contents`,
        so the order stays charts first, history after.
      */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
        <div className="contents lg:grid lg:gap-6">
          <section aria-labelledby="weeks-title" className="grid gap-1">
            <SectionHeader id="weeks-title" title="Treinos por semana" />
            <Card>
              <WeekBars weeks={stats.weeks} />
            </Card>
          </section>

          <CycleCalendar days={stats.calendar} />

          <section aria-labelledby="loads-title" className="grid gap-1">
            <SectionHeader id="loads-title" title="Evolução de carga" />
            {stats.trends.length === 0 ? (
              <Card>
                <p className="text-sm text-muted">Sem cargas registradas no período.</p>
              </Card>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {stats.trends.map((t) => (
                  <li key={t.exerciseId}>
                    <Card padding="sm" className="grid gap-2">
                      <Link
                        to={`/treino/exercicio/${t.exerciseId}`}
                        className="flex min-h-11 items-center justify-between gap-2 rounded-control font-semibold text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="min-w-0 [overflow-wrap:anywhere]">{t.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-sm font-normal text-muted tabular-nums">
                          {t.sessions} {t.sessions === 1 ? 'sessão' : 'sessões'}
                          <Icon name="chevronRight" size={18} />
                        </span>
                      </Link>
                      <E1rmChart points={t.points} />
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="contents lg:grid lg:gap-6">
          <section aria-labelledby="history-title" className="grid gap-1">
            <SectionHeader id="history-title" title="Histórico" />
            {loaded.history.length === 0 ? (
              <EmptyState icon="history">Nenhum treino registrado ainda.</EmptyState>
            ) : (
              <ul className={cardClasses({ tone: 'list' })}>
                {loaded.history.map(({ session, setCount, volume }) => (
                  <li key={session.id}>
                    <ListRow
                      title={
                        // The chips go with the date, so every row's volume stays in the same right column.
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <time dateTime={session.date}>{formatDate(session.date)}</time>
                          {session.endedAt === null && <Chip>Em andamento</Chip>}
                          {session.source === 'hevy' && <Chip>Hevy</Chip>}
                        </span>
                      }
                      subtitle={
                        <span className="tabular-nums">
                          {dayName(session)}
                          {session.source === 'hevy' && session.externalTitle ? ` (${session.externalTitle})` : ''}, {setCount}{' '}
                          {setCount === 1 ? 'série' : 'séries'}
                        </span>
                      }
                      value={formatVolume(volume)}
                      to={`/treino/${session.id}`}
                    />
                  </li>
                ))}
              </ul>
            )}
            {loaded.hasMore && (
              <Button className="mt-2" disabled={loadingMore} onClick={() => void loadMore()}>
                Carregar mais
              </Button>
            )}
          </section>

          {loaded.exercises.length > 0 && (
            <section aria-labelledby="exercises-title" className="grid gap-1">
              <SectionHeader id="exercises-title" title="Exercícios" />
              <ul className={cardClasses({ tone: 'list' })}>
                {loaded.exercises.map((e) => (
                  <li key={e.id}>
                    <ListRow to={`/treino/exercicio/${e.id}`} title={e.name} subtitle={muscleGroupLabel(e.primaryMuscleGroup)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
