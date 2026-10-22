import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionSummary } from '../../data/workoutRepo'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { buttonClass } from '../plans/styles'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { EmptyState } from '../../ui/EmptyState'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'
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
        <h1 className="text-xl font-bold">Histórico de treinos</h1>
      </div>

      <section aria-label="Sessões" className="grid gap-3">
        {loaded.rows.length === 0 ? (
          <EmptyState icon="history">Nenhum treino registrado ainda.</EmptyState>
        ) : (
          <ul className={cardClasses({ tone: 'list' })}>
            {loaded.rows.map(({ session, setCount, volume }) => (
              <li key={session.id}>
                <ListRow
                  title={<time dateTime={session.date}>{formatDate(session.date)}</time>}
                  subtitle={
                    <span className="tabular-nums">
                      {loaded.dayNames.get(session.planVersionId)?.get(session.dayKey) ?? session.dayKey}, {setCount} {setCount === 1 ? 'série' : 'séries'}
                    </span>
                  }
                  value={formatVolume(volume)}
                  trailing={session.endedAt === null ? <Chip tone="accent">em andamento</Chip> : undefined}
                />
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
        <section aria-label="Exercícios" className="grid gap-1">
          <SectionHeader title="Exercícios" />
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
  )
}
