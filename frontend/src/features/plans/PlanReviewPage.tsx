import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { api } from '../../api/client'
import type { components } from '../../api/schema'
import { toProblem } from '../../api/problem'
import { useData } from '../../data/dataContext'
import { exerciseRepo } from '../../data/exerciseRepo'
import { normalizeExerciseName } from '../../domain/exerciseNames'
import type { MuscleGroup } from '../../domain/muscleGroups'
import {
  parseProtocolDocument,
  parseWorkoutDocument,
  type ProtocolDocument,
  type WorkoutDocument,
} from '../../domain/planDocuments'
import { isCalendarDate } from '../../domain/calendarDate'
import { localDate } from '../checkin/localDate'
import { useSync } from '../sync/syncContext'
import { DiffList, type PlanDiff } from './DiffList'
import { Section, TextField } from './fields'
import { LowConfidenceContext } from './lowConfidence'
import { buttonClass } from './styles'
import { ProtocolEditor } from './ProtocolEditor'
import { describePath, validateProtocol, validateWorkout, type Issue } from './validation'
import { initialGroups, newExerciseEntries } from './newExercises'
import { WorkoutPlanEditor } from './WorkoutPlanEditor'

type PlanVersion = components['schemas']['PlanVersionResponse']
type Doc = WorkoutDocument | ProtocolDocument

const OFFLINE = 'Conecte-se à internet para ativar'
const EXTRACTION_BANNER = 'Não consegui ler esse PDF. Você pode preencher à mão.'

/** The document as the editors want it (lists present, defaults filled). An unreadable one starts blank. */
function toEditable(plan: PlanVersion): Doc {
  if (plan.kind === 'workout') {
    const parsed = parseWorkoutDocument(plan.document)
    return parsed.ok ? parsed.value : { days: [] }
  }
  const parsed = parseProtocolDocument(plan.document)
  return parsed.ok ? parsed.value : { meals: [], items: [], guidelines: [] }
}

/** Messages of a failed call: the validation errors by field when the server sent them, else its title. */
function problemMessages(error: unknown): string[] {
  const errors = (error as { errors?: Record<string, string[]> } | null)?.errors
  if (errors && typeof errors === 'object') {
    const all = Object.entries(errors).flatMap(([path, messages]) => messages.map((m) => `${path}: ${m}`))
    if (all.length > 0) return all
  }
  const problem = toProblem(error)
  return [problem.detail ?? problem.title]
}

export function PlanReviewPage() {
  const { id } = useParams()
  const { online, syncNow, dataVersion } = useSync()
  const data = useData()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<PlanVersion | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [groups, setGroups] = useState<Record<string, MuscleGroup>>({})
  const [catalog, setCatalog] = useState<ReadonlySet<string>>(new Set())
  const [diff, setDiff] = useState<PlanDiff | null>(null)
  const [cycleStart, setCycleStart] = useState(() => localDate())
  const [working, setWorking] = useState<'saving' | 'activating' | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Unsaved edits. A ref, so the blocker and the unload handler see a change made a moment ago (and a save that just ended).
  const dirty = useRef(false)
  const blocker = useBlocker(() => dirty.current)

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // The catalog on the device: what is not in it needs a muscle group.
  useEffect(() => {
    if (!data) return
    let cancelled = false
    exerciseRepo
      .all(data.db)
      .then((list) => {
        if (!cancelled) setCatalog(new Set(list.flatMap((e) => [e.normalizedName, ...e.aliases.map(normalizeExerciseName)])))
      })
      .catch((e: unknown) => console.error('could not read the exercises', e))
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])
  const issuesId = useId()

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api
      .GET('/api/plans/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (cancelled) return
        if (!data) {
          setLoadError(response.status === 404 ? 'Plano não encontrado.' : 'Não foi possível abrir o plano.')
          return
        }
        const editable = toEditable(data)
        setPlan(data)
        setDoc(editable)
        setGroups(data.kind === 'workout' ? initialGroups(editable as WorkoutDocument, data.newExercises) : {})
        setDiff(data.diff)
        dirty.current = false
      })
      .catch(() => {
        if (!cancelled) setLoadError('Conecte-se à internet para revisar o plano.')
      })
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  const issues: Issue[] = useMemo(() => {
    if (!plan || !doc) return []
    const found = plan.kind === 'workout' ? validateWorkout(doc) : validateProtocol(doc)
    if (plan.kind === 'protocol' && cycleStart !== '' && !isCalendarDate(cycleStart)) found.push({ path: 'cycleStart', message: 'Data de início do ciclo inválida.' })
    return found
  }, [plan, doc, cycleStart])

  const newExercises = useMemo(
    () => (plan?.kind === 'workout' && doc ? newExerciseEntries(doc as WorkoutDocument, catalog, groups) : []),
    [plan, doc, catalog, groups],
  )

  if (loadError) {
    return (
      <div className="grid gap-3">
        <p role="alert" className="text-danger">
          {loadError}
        </p>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} onClick={() => {
              setLoadError(null)
              setAttempt((n) => n + 1)
            }}>
            Tentar de novo
          </button>
          <Link to="/planejamento" className={`${buttonClass} grid place-items-center`}>
            Voltar
          </Link>
        </div>
      </div>
    )
  }
  if (!plan || !doc) return <p className="text-muted">Carregando…</p>
  if (plan.status !== 'draft') {
    return (
      <div className="grid gap-3">
        <p>Esta versão não é mais um rascunho.</p>
        <Link to="/planejamento" className="font-semibold text-accent underline">
          Voltar ao planejamento
        </Link>
      </div>
    )
  }

  const edit = (next: Doc) => {
    dirty.current = true
    setDoc(next)
    setSaved(false)
  }
  const body = () => ({
    document: doc as unknown,
    newExercises: plan.kind === 'workout' ? newExercises.map(({ name, group }) => ({ name, group })) : null,
  })

  /** Saves the draft; resolves with whether it worked. */
  const save = async (): Promise<boolean> => {
    const { data, error } = await api.PUT('/api/plans/{id}', { params: { path: { id: plan.id } }, body: body() })
    if (!data) {
      setActionErrors(problemMessages(error))
      return false
    }
    // The server keeps the extraction error on the draft; once the user has filled it in, the banner is done.
    setPlan({ ...data, extractionError: null })
    setDiff(data.diff)
    dirty.current = false
    return true
  }

  const run = async (mode: 'saving' | 'activating') => {
    if (working) return
    setWorking(mode)
    setActionErrors([])
    setSaved(false)
    try {
      if (!(await save())) return
      if (mode === 'saving') {
        setSaved(true)
        return
      }
      const { data, error } = await api.POST('/api/plans/{id}/activate', {
        params: { path: { id: plan.id } },
        body: { cycleStart: plan.kind === 'protocol' && cycleStart !== '' ? cycleStart : null },
      })
      if (!data) {
        setActionErrors(problemMessages(error))
        return
      }
      await syncNow() // brings the new active version (and its exercises) to the device
      void navigate('/planejamento')
    } catch {
      setActionErrors([OFFLINE])
    } finally {
      setWorking(null)
    }
  }

  // A cleared reps box cannot be saved even as a draft (it would come back as 0).
  const incomplete = issues.some((i) => /\.reps(Min|Max)$/.test(i.path))
  const blocked = issues.length > 0 || !online
  const title = plan.kind === 'workout' ? 'Revisar treino' : 'Revisar protocolo'

  return (
    <LowConfidenceContext value={plan.lowConfidence}>
      <div className="grid gap-4 pb-4">
        {blocker.state === 'blocked' && (
          <div role="alertdialog" aria-label="Descartar alterações?" className="grid gap-3 rounded-control border border-danger/40 bg-surface p-4">
            <p className="font-semibold">Descartar alterações?</p>
            <p className="text-sm text-muted">Você editou este plano e não salvou.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={() => blocker.reset()}>
                Continuar editando
              </button>
              <button type="button" className={`${buttonClass} text-danger`} onClick={() => blocker.proceed()}>
                Descartar
              </button>
            </div>
          </div>
        )}
        <h1 className="text-xl font-semibold">{title}</h1>

        {plan.extractionError && (
          <p role="alert" className="rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            {EXTRACTION_BANNER}
          </p>
        )}
        {plan.lowConfidence.length > 0 && (
          <p className="text-sm text-muted">Os campos marcados com “Confira” podem ter sido lidos errado do PDF.</p>
        )}

        <Section title="O que mudou">
          <DiffList diff={diff} />
        </Section>

        {plan.kind === 'workout' ? (
          <WorkoutPlanEditor
            doc={doc as WorkoutDocument}
            onChange={edit}
            newExercises={newExercises}
            onGroupChange={(id, group) => {
              dirty.current = true
              setGroups((current) => ({ ...current, [id]: group }))
              setSaved(false)
            }}
          />
        ) : (
          <ProtocolEditor doc={doc as ProtocolDocument} onChange={edit} />
        )}

        <Section title="Ativação">
          {plan.kind === 'protocol' && (
            <TextField
              label="Início do ciclo"
              type="date"
              value={cycleStart}
              onChange={(v) => {
                dirty.current = true
                setCycleStart(v ?? '')
              }}
            />
          )}
          {issues.length > 0 && (
            <div id={issuesId} className="grid gap-1 text-sm text-danger">
              <p className="font-semibold">Corrija antes de ativar:</p>
              <ul className="list-disc pl-5">
                {issues.map((issue, i) => {
                  const where = describePath(issue.path, doc)
                  return (
                    <li key={i}>
                      {where && <span className="text-muted">{where}: </span>}
                      {issue.message}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {!online && <p className="text-sm text-muted">{OFFLINE}</p>}
          {actionErrors.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-sm text-danger">
              {actionErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
          {saved && <p role="status" className="text-sm text-ok">Rascunho salvo</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={!online || working !== null || incomplete} onClick={() => void run('saving')}>
              {working === 'saving' ? 'Salvando…' : 'Salvar rascunho'}
            </button>
            <button
              type="button"
              disabled={blocked || working !== null}
              aria-describedby={issues.length > 0 ? issuesId : undefined}
              onClick={() => void run('activating')}
              className="min-h-11 rounded-control bg-accent px-5 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              {working === 'activating' ? 'Ativando…' : 'Ativar'}
            </button>
          </div>
        </Section>
      </div>
    </LowConfidenceContext>
  )
}
