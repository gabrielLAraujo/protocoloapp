import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionLocal } from '../../data/workoutRepo'
import { Icon } from '../../ui/Icon'
import { buttonClasses } from '../../ui/styles'
import { formatShortDate } from '../workout/format'
import { SessionReadView } from '../workout/SessionReadView'
import { loadWorkoutPlans } from '../workout/workoutPlans'

interface Loaded {
  session: SessionLocal | null
  /** The plan day's name, when the session's day is still in its plan version. */
  dayName: string | null
  catalog: ExerciseLocal[]
}

/** What a page sends back to `/treino` (`navigate('/treino', { state })`). */
export interface TrainingNotice {
  notice?: string
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const BackLink = () => (
  <Link to="/treino" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
    <Icon name="chevronLeft" size={18} />
    Voltar para o treino
  </Link>
)

/**
 * `/treino/:id`: any session (Hevy or app, finished or never finished) opened only to view, with "Excluir do app";
 * after a delete it goes back to `/treino` with a confirmation.
 */
export function SessionPage() {
  const { id = '' } = useParams()
  const data = useData()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    ;(async () => {
      const [session, plans, catalog] = await Promise.all([workoutRepo.sessionById(data.db, id), loadWorkoutPlans(data.db), exerciseRepo.all(data.db)])
      const day = session ? plans.find((p) => p.id === session.planVersionId)?.document.days.find((d) => d.key === session.dayKey) : undefined
      return { session, dayName: day?.name ?? null, catalog }
    })().then(
      (result) => {
        if (!cancelled) setLoaded(result)
      },
      (e: unknown) => {
        console.error('could not read the session', e)
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, id])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data || !loaded) return <Message>Carregando…</Message>
  const { session } = loaded
  if (!session)
    return (
      <div className="grid gap-3">
        <BackLink />
        <p role="alert">Treino não encontrado.</p>
      </div>
    )

  return (
    <div className="grid gap-2 lg:mx-auto lg:max-w-[760px]">
      <BackLink />
      <SessionReadView
        key={session.id}
        data={data}
        session={session}
        dayName={loaded.dayName ?? 'Treino'}
        catalog={loaded.catalog}
        onDeleted={() => {
          const state: TrainingNotice = { notice: `Treino de ${formatShortDate(session.date)} excluído do app` }
          void navigate('/treino', { state })
        }}
      />
    </div>
  )
}

/** `/treino/historico/:id` (the old session link) opens the same session at `/treino/:id`. */
export function OldSessionRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/treino/${id}`} replace />
}
