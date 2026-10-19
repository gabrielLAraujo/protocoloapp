import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SetLocal } from '../../data/workoutRepo'
import { bestSet, e1rm } from '../../domain/strength'
import { E1rmChart, type E1rmPoint } from './E1rmChart'
import { formatDate, formatKg } from './format'
import { buttonClasses } from '../../ui/styles'
import { cardClasses } from '../../ui/styles'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'

interface SessionRow {
  sessionId: string
  date: string
  sets: SetLocal[]
  /** e1RM of the best working set; null when the session only had warm-ups. */
  best: number | null
}

/** `/treino/exercicio/:id`: the sessions of one exercise (table) and its e1RM over time (chart). */
export function ExerciseHistoryPage() {
  const data = useData()
  const { id } = useParams()
  const [loaded, setLoaded] = useState<{ exercise: ExerciseLocal | null; rows: SessionRow[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data || !id) return
    let cancelled = false
    ;(async () => {
      const { db } = data
      const [exercise, sets, sessions] = await Promise.all([
        exerciseRepo.byId(db, id),
        workoutRepo.setsForExercise(db, id, 5000),
        workoutRepo.sessionsBetween(db, '0000-01-01', '9999-12-31'),
      ])
      const dateOf = new Map(sessions.map((s) => [s.id, s.date]))
      const bySession = new Map<string, SetLocal[]>()
      for (const s of sets) {
        if (!dateOf.has(s.sessionId)) continue
        bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s])
      }
      const rows: SessionRow[] = [...bySession].map(([sessionId, list]) => {
        const ordered = [...list].sort((a, b) => a.setIndex - b.setIndex || a.completedAt.localeCompare(b.completedAt))
        const top = bestSet(ordered)
        return { sessionId, date: dateOf.get(sessionId)!, sets: ordered, best: top ? e1rm(top.weightKg, top.reps) : null }
      })
      rows.sort((a, b) => a.date.localeCompare(b.date))
      return { exercise, rows }
    })()
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
      .catch((error: unknown) => {
        console.error('could not read the exercise history', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, id])

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  const { exercise, rows } = loaded
  const points: E1rmPoint[] = rows.flatMap((r) => (r.best === null ? [] : [{ date: r.date, value: r.best }]))

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/treino/historico" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
          <Icon name="chevronLeft" size={18} />
          Voltar para o histórico
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{exercise?.name ?? 'Exercício'}</h1>
      </div>
      <div className={cardClasses({ padding: 'sm' })}>
        <E1rmChart points={points} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="dumbbell">Nenhuma série registrada neste exercício.</EmptyState>
      ) : (
        <div className={cardClasses({ padding: 'sm', className: 'overflow-x-auto' })}>
          <table className="w-full text-left text-sm">
            <caption className="pb-2 text-left text-base font-semibold">Sessões</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Data
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Séries
                </th>
                <th scope="col" className="py-1 font-medium">
                  1RM estimado
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.sessionId} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-1.5 pr-3">{r.sets.map((s) => `${formatKg(s.weightKg)} × ${s.reps}`).join(' · ')}</td>
                  <td className="py-1.5 whitespace-nowrap tabular-nums">{r.best === null ? '—' : `${formatKg(Math.round(r.best * 10) / 10)} kg`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
