import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionLocal, type SetLocal } from '../../data/workoutRepo'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { formatDate, formatVolume } from './format'
import { volumeOf } from './volume'
import { loadWorkoutPlans } from './workoutPlans'

interface Row {
  session: SessionLocal
  dayName: string
  volume: number
}

interface Loaded {
  rows: Row[]
  exercises: ExerciseLocal[]
}

/** `/treino/historico`: sessions by date (newest first) with day and volume, and the exercises that were done. */
export function HistoryPage() {
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    ;(async () => {
      const { db } = data
      const [sessions, plans, catalog] = await Promise.all([workoutRepo.sessionsBetween(db, '0000-01-01', '9999-12-31'), loadWorkoutPlans(db), exerciseRepo.all(db)])
      const setsBySession = await Promise.all(sessions.map((s) => workoutRepo.setsForSession(db, s.id)))
      const dayName = (s: SessionLocal) => plans.find((p) => p.id === s.planVersionId)?.document.days.find((d) => d.key === s.dayKey)?.name ?? s.dayKey
      const rows = sessions.map((session, i) => ({ session, dayName: dayName(session), volume: volumeOf(setsBySession[i]!) }))
      const done = new Set(setsBySession.flat().map((s: SetLocal) => s.exerciseId))
      return { rows: rows.reverse(), exercises: catalog.filter((e) => done.has(e.id)) }
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

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  return (
    <div className="grid gap-5">
      <h1 className="text-xl font-semibold">Histórico de treinos</h1>
      <Link to="/treino" className="text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
        Voltar para o treino de hoje
      </Link>

      <section aria-label="Sessões" className="grid gap-2">
        {loaded.rows.length === 0 ? (
          <p className="text-muted">Nenhum treino registrado ainda.</p>
        ) : (
          <ul className="grid gap-2">
            {loaded.rows.map(({ session, dayName, volume }) => (
              <li key={session.id} className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2">
                <div>
                  <p className="font-medium">{formatDate(session.date)}</p>
                  <p className="text-sm text-muted">
                    {dayName}
                    {session.endedAt === null ? ' · em andamento' : ''}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums">{formatVolume(volume)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loaded.exercises.length > 0 && (
        <section aria-label="Exercícios" className="grid gap-2">
          <h2 className="text-base font-semibold">Exercícios</h2>
          <ul className="grid gap-1">
            {loaded.exercises.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/treino/exercicio/${e.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line px-3 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span>{e.name}</span>
                  <span className="text-xs text-muted">{muscleGroupLabel(e.primaryMuscleGroup)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
