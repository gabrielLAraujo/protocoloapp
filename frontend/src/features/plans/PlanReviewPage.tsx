import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { api } from '../../api/client'
import type { components } from '../../api/schema'
import { toProblem } from '../../api/problem'
import { useData } from '../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../data/exerciseRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
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
import { buttonClass, dangerButtonClass } from './styles'
import { ACTION_ROW, buttonClasses, cardClasses } from '../../ui/styles'
import { ProtocolEditor } from './ProtocolEditor'
import { describePath, validateProtocol, validateWorkout, type Issue } from './validation'
import { initialCatalogIds, initialGroups, newExerciseEntries } from './newExercises'
import { WorkoutWizard } from './workoutWizard/WorkoutWizard'
import { ImportError, readWithAi } from './uploadPdf'

type PlanVersion = components['schemas']['PlanVersionResponse']
type Doc = WorkoutDocument | ProtocolDocument

const OFFLINE = 'Conecte-se à internet para ativar'
const EXTRACTION_BANNER = 'Não consegui ler esse PDF. Você pode preencher à mão.'
const NO_CREDITS_BANNER =
  'A IA está sem créditos. Recarregue em console.anthropic.com → Plans & Billing e tente de novo — ou preencha à mão.'

/** The banner for a draft whose extraction failed: the out-of-credits case says what to do; anything else is generic. */
function extractionBanner(error: string): string {
  return error === 'no_credits' ? NO_CREDITS_BANNER : EXTRACTION_BANNER
}

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
/** The notice the import left in the navigation state (the device could not read the PDF). */
function routeNotice(state: unknown): string | null {
  const notice = (state as { notice?: unknown } | null)?.notice
  return typeof notice === 'string' ? notice : null
}

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
  const location = useLocation()
  const notice = routeNotice(location.state)
  // Shown until the draft is saved once (the user has filled it in).
  const [noticeDone, setNoticeDone] = useState(false)
  // Whether the server can read PDFs with the AI too: then the review offers it on the same file.
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReading, setAiReading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanVersion | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [groups, setGroups] = useState<Record<string, MuscleGroup>>({})
  // The catalog item (media) each new exercise carries from the draft; sent back on every save.
  const [catalogIds, setCatalogIds] = useState<Record<string, string>>({})
  const [catalog, setCatalog] = useState<ReadonlySet<string>>(new Set())
  const [userExercises, setUserExercises] = useState<ExerciseLocal[]>([])
  // Which exercises are new depends on the catalog: until it is read nothing may be saved or activated.
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading')
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
        if (cancelled) return
        setUserExercises(list)
        setCatalog(new Set(list.flatMap((e) => [e.normalizedName, ...e.aliases.map(normalizeExerciseName)])))
        setCatalogState('ready')
      })
      .catch((e: unknown) => {
        console.error('could not read the exercises', e)
        if (!cancelled) setCatalogState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])
  const issuesId = useId()

  useEffect(() => {
    let cancelled = false
    api
      .GET('/api/plans/extraction')
      .then(({ data }) => {
        if (!cancelled) setAiAvailable(data?.ai === true)
      })
      .catch(() => undefined) // offline: no AI button, the review itself says to connect
    return () => {
      cancelled = true
    }
  }, [])

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
        setCatalogIds(data.kind === 'workout' ? initialCatalogIds(editable as WorkoutDocument, data.newExercises) : {})
        setDiff(data.diff)
        setNoticeDone(false)
        setSaved(false)
        setActionErrors([])
        setAiError(null)
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
    () => (plan?.kind === 'workout' && doc ? newExerciseEntries(doc as WorkoutDocument, catalog, groups, catalogIds) : []),
    [plan, doc, catalog, groups, catalogIds],
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
          <Link to="/planejamento" className={buttonClass}>
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
    newExercises: plan.kind === 'workout' ? newExercises.map(({ name, group, catalogId }) => (catalogId ? { name, group, catalogId } : { name, group })) : null,
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
    setNoticeDone(true)
    // The PUT answers without a diff: keep the one on screen.
    setDiff((previous) => data.diff ?? previous)
    dirty.current = false
    return true
  }

  /** The draft save the wizard asks for when a day is confirmed. */
  const saveForStep = async (): Promise<boolean> => {
    if (working) return false
    setWorking('saving')
    setActionErrors([])
    setSaved(false)
    try {
      return await save()
    } catch {
      setActionErrors([OFFLINE])
      return false
    } finally {
      setWorking(null)
    }
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
      const { data: activatedPlan, error } = await api.POST('/api/plans/{id}/activate', {
        params: { path: { id: plan.id } },
        body: { cycleStart: plan.kind === 'protocol' && cycleStart !== '' ? cycleStart : null },
      })
      if (!activatedPlan) {
        setActionErrors(problemMessages(error))
        return
      }
      // New meal keys get their suggested times (the reminders read them), from the document just activated: the
      // device has not pulled it yet. The sync below sends them and brings the new active version (and its exercises).
      if (plan.kind === 'protocol' && data) {
        const activated = parseProtocolDocument(activatedPlan.document)
        // Already active on the server: a local failure here must not report the activation as failed (Horários retries).
        if (activated.ok) {
          await scheduleRepo.ensureDefaults(data.db, data.userId, activated.value).catch((e: unknown) => {
            console.error('could not create the suggested times', e)
          })
        }
      }
      await syncNow()
      void navigate('/planejamento')
    } catch {
      setActionErrors([OFFLINE])
    } finally {
      setWorking(null)
    }
  }

  // A cleared reps box cannot be saved even as a draft (it would come back as 0).
  const incomplete = issues.some((i) => /\.reps(Min|Max)$/.test(i.path))
  const catalogReady = plan.kind !== 'workout' || catalogState === 'ready'
  const blocked = issues.length > 0 || !online || !catalogReady
  const title = plan.kind === 'workout' ? 'Revisar treino' : 'Revisar protocolo'
  const banner = plan.extractionError ? extractionBanner(plan.extractionError) : noticeDone ? null : notice

  /** Reads the same PDF again with the AI: a new draft, opened in place of this one. */
  const readAgainWithAi = async () => {
    if (aiReading) return
    setAiReading(true)
    setAiError(null)
    try {
      const newId = await readWithAi(plan.kind, plan.sourceFileId)
      void navigate(`/planejamento/revisao/${newId}`)
    } catch (e) {
      setAiError(e instanceof ImportError ? e.message : 'Não foi possível ler com IA. Tente novamente.')
    } finally {
      setAiReading(false)
    }
  }

  return (
    <LowConfidenceContext value={plan.lowConfidence}>
      <div className="grid gap-4 pb-4">
        {blocker.state === 'blocked' && (
          <div role="alertdialog" aria-label="Descartar alterações?" className="grid gap-3 rounded-card border border-danger/40 bg-surface p-4 shadow-card">
            <p className="text-lg font-semibold">Descartar alterações?</p>
            <p className="text-sm text-muted">Você editou este plano e não salvou.</p>
            <div className={ACTION_ROW}>
              <button type="button" className={buttonClass} onClick={() => blocker.reset()}>
                Continuar editando
              </button>
              <button type="button" className={dangerButtonClass} onClick={() => blocker.proceed()}>
                Descartar
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{title}</h1>
          {aiAvailable && (
            <button type="button" className={buttonClasses({ variant: 'secondary' })} disabled={!online || aiReading || working !== null} onClick={() => void readAgainWithAi()}>
              {aiReading ? 'Lendo com IA…' : 'Ler com IA'}
            </button>
          )}
        </div>
        {aiReading && (
          <p role="status" className="rounded-control border border-line bg-raised px-3 py-2 text-sm font-medium">
            Lendo o PDF com IA…
            <span className="block text-muted">Pode demorar até 90 segundos. Não feche esta tela.</span>
          </p>
        )}
        {aiError && (
          <p role="alert" className="text-sm text-danger">
            {aiError}
          </p>
        )}

        {banner && (
          <p role="alert" className={cardClasses({ tone: 'warn', className: 'text-sm font-medium' })}>
            {banner}
          </p>
        )}
        {plan.lowConfidence.length > 0 && (
          <p className="text-sm text-muted">Os campos marcados com “Confira” podem ter sido lidos errado do PDF.</p>
        )}

        {plan.kind === 'workout' ? (
          <WorkoutWizard
            key={plan.id}
            planId={plan.id}
            doc={doc as WorkoutDocument}
            onChange={edit}
            newExercises={newExercises}
            userExercises={userExercises}
            lowConfidence={plan.lowConfidence}
            issues={issues}
            diff={diff}
            online={online}
            catalogState={catalogState}
            working={working}
            saved={saved}
            actionErrors={actionErrors}
            onGroupChange={(id, group) => {
              dirty.current = true
              setGroups((current) => ({ ...current, [id]: group }))
              setSaved(false)
            }}
            onCatalogChange={(id, catalogId) => {
              dirty.current = true
              setCatalogIds((current) => {
                const next = { ...current }
                if (catalogId) next[id] = catalogId
                else delete next[id]
                return next
              })
              setSaved(false)
            }}
            saveDraft={saveForStep}
            onSaveDraft={() => void run('saving')}
            onActivate={() => void run('activating')}
            isDirty={() => dirty.current}
          />
        ) : (
          <>
            <Section title="O que mudou">
              <DiffList diff={diff} />
            </Section>
            <ProtocolEditor doc={doc as ProtocolDocument} onChange={edit} />
            <Section title="Ativação">
              <TextField
                label="Início do ciclo"
                type="date"
                value={cycleStart}
                onChange={(v) => {
                  dirty.current = true
                  setCycleStart(v ?? '')
                }}
              />
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
              <div className={ACTION_ROW}>
                <button type="button" className={buttonClass} disabled={!online || working !== null || incomplete} onClick={() => void run('saving')}>
                  {working === 'saving' ? 'Salvando…' : 'Salvar rascunho'}
                </button>
                <button
                  type="button"
                  disabled={blocked || working !== null}
                  aria-describedby={issues.length > 0 ? issuesId : undefined}
                  onClick={() => void run('activating')}
                  className={buttonClasses({ variant: 'primary' })}
                >
                  {working === 'activating' ? 'Ativando…' : 'Ativar'}
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
    </LowConfidenceContext>
  )
}
