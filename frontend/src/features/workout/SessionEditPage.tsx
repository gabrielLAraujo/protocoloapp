import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionLocal } from '../../data/workoutRepo'
import type { WorkoutDay } from '../../domain/planDocuments'
import { Icon } from '../../ui/Icon'
import { buttonClasses } from '../../ui/styles'
import { formatShortDate } from './format'
import type { HistoryNotice } from './HistoryPage'
import { SessionView } from './SessionView'
import { loadWorkoutPlans } from './workoutPlans'

interface Loaded {
  session: SessionLocal | null
  day: WorkoutDay | undefined
  catalog: ExerciseLocal[]
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const BackLink = () => (
  <Link to="/treino/historico" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
    <Icon name="chevronLeft" size={18} />
    Voltar para o histórico
  </Link>
)

/** `/treino/historico/:id`: a finished workout opened from the history to fix its sets (log mode: no timer, "Salvar treino"). */
export function SessionEditPage() {
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
      return { session, day, catalog }
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
  const { session, day } = loaded
  if (!session || session.endedAt === null)
    return (
      <div className="grid gap-3">
        <BackLink />
        <p role="alert">Este treino não está no histórico.</p>
      </div>
    )
  if (!day)
    return (
      <div className="grid gap-3">
        <BackLink />
        <p role="alert">Não encontrei o treino desta sessão na ficha.</p>
      </div>
    )

  const back = (notice?: string) => {
    const state: HistoryNotice = { notice }
    void navigate('/treino/historico', { state })
  }
  return (
    <div className="grid gap-2 lg:mx-auto lg:max-w-[760px]">
      <BackLink />
      <SessionView
        data={data}
        session={session}
        day={day}
        catalog={loaded.catalog}
        mode="log"
        onFinished={() => back(`Treino de ${formatShortDate(session.date)} salvo`)}
        onDiscarded={() => back()}
      />
    </div>
  )
}
