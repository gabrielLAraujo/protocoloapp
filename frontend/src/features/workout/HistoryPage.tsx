import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionSummary } from '../../data/workoutRepo'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { buttonClass } from '../plans/styles'
import { buttonClasses } from '../../ui/styles'
import { cardClasses } from '../../ui/styles'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { formatDate, formatVolume } from './format'
import { loadWorkoutPlans } from './workoutPlans'

const PAGE_SIZE = 60

interface Loaded {
  rows: SessionSummary[]
  hasMore: boolean
  exercises: ExerciseLocal[]
  /** plan version id -> day key -> day name */
  dayNames: Map<string, Map<string, string>>
}

/** `/treino/historico`: sessions by date (newest first, 60 at a time) with day and volume, and the exercises that were done. */
export function HistoryPage() {
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    ;(async () => {
      const { db } = data
      // One aggregate query for the sessions (+1 row to know whether there are more), one for the exercises done.
      const [page, plans, catalog, doneIds] = await Promise.all([
        workoutRepo.sessionSummaries(db, PAGE_SIZE + 1, 0),
        loadWorkoutPlans(db),
        exerciseRepo.all(db),
        workoutRepo.exerciseIdsWithSets(db),
      ])
      const done = new Set(doneIds)
      const dayNames = new Map(plans.map((p) => [p.id, new Map(p.document.days.map((d) => [d.key, d.name]))]))
      return { rows: page.slice(0, PAGE_SIZE), hasMore: page.length > PAGE_SIZE, exercises: catalog.filter((e) => done.has(e.id)), dayNames }
    })()
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
      .catch((error: unknown) => {
        console.error('could not read the history', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data])

  async function loadMore() {
    if (!data || !loaded || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await workoutRepo.sessionSummaries(data.db, PAGE_SIZE + 1, loaded.rows.length)
      setLoaded({ ...loaded, rows: [...loaded.rows, ...page.slice(0, PAGE_SIZE)], hasMore: page.length > PAGE_SIZE })
    } catch (error) {
      console.error('could not read more history', error)
      setFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/treino" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
          <Icon name="chevronLeft" size={18} />
          Voltar para o treino de hoje
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Histórico de treinos</h1>
      </div>

      <section aria-label="Sessões" className="grid gap-2">
        {loaded.rows.length === 0 ? (
          <EmptyState icon="history">Nenhum treino registrado ainda.</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {loaded.rows.map(({ session, setCount, volume }) => (
              <li key={session.id} className={cardClasses({ padding: 'sm', className: 'flex items-center justify-between gap-3' })}>
                <div>
                  <p className="font-medium">{formatDate(session.date)}</p>
                  <p className="text-sm text-muted">
                    {loaded.dayNames.get(session.planVersionId)?.get(session.dayKey) ?? session.dayKey} · {setCount} {setCount === 1 ? 'série' : 'séries'}
                    {session.endedAt === null ? ' · em andamento' : ''}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatVolume(volume)}</p>
              </li>
            ))}
          </ul>
        )}
        {loaded.hasMore && (
          <button type="button" className={buttonClass} disabled={loadingMore} onClick={() => void loadMore()}>
            Carregar mais
          </button>
        )}
      </section>

      {loaded.exercises.length > 0 && (
        <section aria-label="Exercícios" className="grid gap-2">
          <h2 className="text-base font-semibold">Exercícios</h2>
          <ul className={cardClasses({ padding: 'none', className: 'grid divide-y divide-line overflow-hidden' })}>
            {loaded.exercises.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/treino/exercicio/${e.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 px-4 hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    {muscleGroupLabel(e.primaryMuscleGroup)}
                    <Icon name="chevronRight" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
