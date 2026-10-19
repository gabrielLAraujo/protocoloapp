import { useEffect, useState } from 'react'
import type { Data } from '../../data/dataContext'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionLocal, type SetLocal } from '../../data/workoutRepo'
import { muscleGroupLabel } from '../../domain/muscleGroups'
import { sessionPRs, type PR } from '../../domain/strength'
import { buttonClass } from '../plans/styles'
import { formatDuration, formatKg, formatVolume } from './format'
import { volumeByGroup, volumeOf } from './volume'
import { Button } from '../../ui/Button'
import { cardClasses } from '../../ui/styles'
import { Icon } from '../../ui/Icon'

interface Summary {
  session: SessionLocal
  sets: SetLocal[]
  prs: PR[]
}

/** After "Finalizar treino": duration, volume per muscle group and the records set against the earlier history. */
export function FinishSummary({
  data,
  sessionId,
  date,
  catalog,
  onDone,
}: {
  data: Data
  sessionId: string
  date: string
  catalog: ExerciseLocal[]
  onDone(): void
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)
  const { db } = data

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [sessions, sets] = await Promise.all([workoutRepo.sessionsBetween(db, date, date), workoutRepo.setsForSession(db, sessionId)])
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) throw new Error('Session not found.')
      const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))]
      const history = (await Promise.all(exerciseIds.map((id) => workoutRepo.setsForExercise(db, id, 5000)))).flat().filter((s) => s.sessionId !== sessionId)
      return { session, sets, prs: sessionPRs(sets, history) }
    })()
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch((error: unknown) => {
        console.error('could not build the summary', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [db, sessionId, date])

  if (failed) {
    return (
      <div className="grid gap-3">
        <p role="alert">Não foi possível montar o resumo.</p>
        <button type="button" className={buttonClass} onClick={onDone}>
          Concluir
        </button>
      </div>
    )
  }
  if (!summary) return <p className="text-muted">Montando o resumo…</p>

  const { session, sets, prs } = summary
  const name = (id: string) => catalog.find((e) => e.id === id)?.name ?? 'Exercício'
  const duration = session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : 0
  const groups = volumeByGroup(sets, catalog)

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-bold tracking-tight">Treino finalizado</h1>
      <dl className="grid grid-cols-2 gap-3">
        <div className={cardClasses({ padding: 'sm', className: 'grid gap-1' })}>
          <dt className="text-sm font-medium text-muted">Duração</dt>
          <dd className="text-lg font-bold tabular-nums">{formatDuration(duration)}</dd>
        </div>
        <div className={cardClasses({ padding: 'sm', className: 'grid gap-1' })}>
          <dt className="text-sm font-medium text-muted">Volume total</dt>
          <dd className="text-lg font-bold tabular-nums">{formatVolume(volumeOf(sets))}</dd>
        </div>
      </dl>

      <section aria-label="Volume por grupo" className="grid gap-2">
        <h2 className="text-base font-semibold">Volume por grupo</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma série registrada.</p>
        ) : (
          <ul className={cardClasses({ padding: 'none', className: 'grid divide-y divide-line' })}>
            {groups.map((g) => (
              <li key={g.group} className="flex justify-between gap-3 px-4 py-3">
                <span>{muscleGroupLabel(g.group)}</span>
                <span className="tabular-nums">{formatVolume(g.volume)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {prs.length > 0 && (
        <section aria-label="Recordes" className="grid gap-2">
          <h2 className="text-base font-semibold">Recordes</h2>
          <ul className="grid gap-2">
            {prs.map((pr) => (
              <li key={`${pr.exerciseId}:${pr.kind}`} className={cardClasses({ tone: 'ok', padding: 'sm', className: 'flex items-start gap-3 font-medium' })}>
                <Icon name="trophy" className="mt-0.5 text-ok" />
                {pr.kind === 'maxWeight'
                  ? `Novo recorde: ${name(pr.exerciseId)} — ${formatKg(pr.value)} kg`
                  : `Novo recorde de 1RM estimado: ${name(pr.exerciseId)} — ${formatKg(pr.value)} kg`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="primary" size="lg" onClick={onDone}>
        Concluir
      </Button>
    </div>
  )
}
