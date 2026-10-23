import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { useData } from '../../data/dataContext'
import { newId } from '../../data/ids'
import type { LocalDb } from '../../data/localDb'
import { photoThumbRepo, type PhotoThumbLocal } from '../../data/photoThumbRepo'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { MAX_ANSWER_LENGTH, updateCycleRepo, type UpdateCycleLocal } from '../../data/updateCycleRepo'
import { posesOf, type QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { Chip } from '../../ui/Chip'
import { EmptyState } from '../../ui/EmptyState'
import { buttonClasses } from '../../ui/styles'
import { localDate } from '../checkin/localDate'
import { downloadBlob } from '../settings/templateFile'
import { useSync } from '../sync/syncContext'
import { answersAsText, resolveAnswer } from './answers'
import { CycleNotesSheet } from './CycleNotesSheet'
import { loadMetrics, type LoadedMetrics } from './metricsCache'
import { toJpeg } from './photos/imageTools'
import { photoQueue } from './photos/photoQueue'
import { DOWNLOAD_FAILED_MESSAGE, downloadCyclePhotos, PhotosDownloadError } from './photos/photosZip'
import { PhotosStep } from './PhotosStep'
import { QuestionnairePrint } from './QuestionnairePrint'
import { NoTemplate, QuestionsStep } from './QuestionsStep'
import { ReviewStep, type ReviewAction } from './ReviewStep'
import { dayMonth, periodText } from './updateFormat'
import { photoSyncFor, useUpdateCycle } from './useUpdateCycle'

export const SAVE_DEBOUNCE_MS = 500
export const NATIVE_ZIP_MESSAGE = 'Use o app no navegador para baixar.'

const STEPS = [
  { key: 'photos', label: 'Fotos' },
  { key: 'questions', label: 'Questionário' },
  { key: 'review', label: 'Revisar e enviar' },
] as const
type Step = (typeof STEPS)[number]['key']

type Message = { kind: 'status' | 'alert'; text: string }

interface Side {
  template: QuestionnaireTemplate | null
  /** Thumbnails of this cycle, only those of the photo the cycle holds for the pose. */
  thumbs: Map<string, PhotoThumbLocal>
  previous: UpdateCycleLocal | null
  previousThumbs: Map<string, PhotoThumbLocal>
  /** Poses with a photo still waiting in the queue. */
  pending: Set<string>
}

async function readSide(db: LocalDb, cycle: UpdateCycleLocal): Promise<Side> {
  const [template, thumbs, previous, queued] = await Promise.all([
    questionnaireTemplateRepo.get(db),
    photoThumbRepo.byCycle(db, cycle.id),
    updateCycleRepo.previous(db, cycle.id),
    // No IndexedDB (a locked-down browser): nothing can be queued either.
    photoQueue.list().catch(() => []),
  ])
  const current = new Map([...thumbs].filter(([pose, t]) => cycle.photos.some((p) => p.pose === pose && p.fileId === t.fileId)))
  return {
    template: template?.document ?? null,
    thumbs: current,
    previous,
    previousThumbs: previous ? await photoThumbRepo.byCycle(db, previous.id) : new Map(),
    pending: new Set(queued.filter((p) => p.cycleId === cycle.id).map((p) => p.pose)),
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/**
 * `/atualizacao`: the update of the current cycle in three steps (Fotos, Questionário, Revisar e enviar). The draft is
 * saved on the device at every change (half a second after typing stops) and synced; the metrics come from the
 * server and, offline, from the last answer stored.
 */
export function UpdatePage() {
  const data = useData()
  const { syncNow, dataVersion, online } = useSync()
  const { state, reload } = useUpdateCycle()
  const cycle = state.status === 'ok' ? state.cycle : null
  const [side, setSide] = useState<Side | null>(null)
  const [metrics, setMetrics] = useState<LoadedMetrics | null>(null)
  const [step, setStep] = useState<Step>('photos')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notesOpen, setNotesOpen] = useState(false)
  const [recalculating, setRecalculating] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReviewAction | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [sideTick, setSideTick] = useState(0)
  const native = Capacitor.isNativePlatform()

  const cycleId = cycle?.id ?? null
  const db = data?.db ?? null

  useEffect(() => {
    if (!db || !cycle) return
    let cancelled = false
    readSide(db, cycle).then(
      (s) => {
        if (!cancelled) setSide(s)
      },
      (error: unknown) => console.error('could not read the update', error instanceof Error ? error.name : 'unknown'),
    )
    return () => {
      cancelled = true
    }
  }, [db, cycle, dataVersion, sideTick])

  // The metrics of the cycle: once per cycle (and when the connection comes back); "Recalcular" asks again.
  useEffect(() => {
    if (!db || !cycleId) return
    let cancelled = false
    loadMetrics(db, api, cycleId, new Date()).then(
      (m) => {
        if (!cancelled) setMetrics(m)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [db, cycleId, online])

  // Saving the answers: one timer per question, flushed when the screen closes.
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run(): void }>())
  const latest = useRef<Record<string, string>>({})

  const saveAnswer = useCallback(
    async (key: string, text: string | null) => {
      if (!db || !cycleId) return
      try {
        await updateCycleRepo.setAnswer(db, cycleId, key, text === null ? null : text.slice(0, MAX_ANSWER_LENGTH), new Date())
        void syncNow()
      } catch (error) {
        // Never the answer's text.
        console.error('could not save the answer', error instanceof Error ? error.name : 'unknown')
        setMessage({ kind: 'alert', text: 'Não foi possível salvar a resposta. Tente de novo.' })
      }
      reload()
    },
    [db, cycleId, syncNow, reload],
  )

  // Drafts leave once the stored answer caught up with them (the "Calculado" label is gone by then).
  useEffect(() => {
    if (!cycle) return
    // Adjusted after the cycle is re-read: a draft equal to what is stored and with no timer left is done.
    const done = Object.keys(drafts).filter((k) => !timers.current.has(k) && cycle.answers[k] === drafts[k])
    if (done.length === 0) return
    void Promise.resolve().then(() => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !done.includes(k)))))
  }, [cycle, drafts])

  const flushAll = useCallback(() => {
    for (const { timer, run } of timers.current.values()) {
      clearTimeout(timer)
      run()
    }
    timers.current.clear()
  }, [])

  useEffect(() => () => flushAll(), [flushAll])

  const onChange = (key: string, text: string) => {
    latest.current[key] = text
    setDrafts((d) => ({ ...d, [key]: text }))
    const old = timers.current.get(key)
    if (old) clearTimeout(old.timer)
    const run = () => {
      timers.current.delete(key)
      void saveAnswer(key, latest.current[key] ?? text)
    }
    timers.current.set(key, { timer: setTimeout(run, SAVE_DEBOUNCE_MS), run })
  }

  const onRecalculate = async (key: string) => {
    if (!db || !cycleId) return
    const old = timers.current.get(key)
    if (old) clearTimeout(old.timer)
    timers.current.delete(key)
    setRecalculating(key)
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)))
    try {
      const fresh = await loadMetrics(db, api, cycleId, new Date())
      setMetrics(fresh)
      await saveAnswer(key, null)
    } finally {
      setRecalculating(null)
    }
  }

  const refreshSide = () => setSideTick((n) => n + 1)

  // Photos sent after the connection came back show up without leaving the screen.
  useEffect(() => {
    if (!db) return
    const onOnline = () => void photoSyncFor(db).flush().then(() => {
      reload()
      refreshSide()
    })
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [db, reload])

  const onCapture = async (pose: string, blob: Blob) => {
    if (!db || !cycleId) return
    setPhotoError(null)
    let jpeg: Blob = blob
    try {
      jpeg = await toJpeg(blob)
    } catch {
      // A format the browser cannot decode into a canvas: sent as it came.
    }
    const sync = photoSyncFor(db)
    try {
      await sync.enqueue({ id: newId(), cycleId, pose, blob: jpeg, takenAt: new Date().toISOString() })
    } catch {
      setPhotoError('Não foi possível guardar a foto. Tente de novo.')
      return
    }
    refreshSide()
    await sync.flush()
    reload()
    refreshSide()
  }

  const overlayFor = async (pose: string): Promise<string | null> => {
    if (!side?.previous) return null
    const thumb = side.previousThumbs.get(pose)
    if (thumb) return thumb.dataUrl
    const photo = side.previous.photos.find((p) => p.pose === pose)
    if (!photo || !online) return null
    const { data: signed } = await api.GET('/api/files/{id}/download-url', { params: { path: { id: photo.fileId } } })
    return signed?.url ?? null
  }

  if (!data || state.status === 'loading' || (cycle && !side)) return <p className="text-muted">Carregando…</p>
  if (state.status === 'error') return <p role="alert">Não foi possível abrir a atualização.</p>

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">Atualização</h1>
        {cycle && <p className="text-sm text-muted tabular-nums">{periodText(cycle)}</p>}
      </div>
      {cycle?.status === 'sent' && cycle.sentAt && (
        <Chip tone="ok" icon="check">
          Enviada em {dayMonth(cycle.sentAt)}
        </Chip>
      )}
    </div>
  )

  if (!cycle || !side) {
    return (
      <section className="grid gap-6">
        {header}
        <EmptyState
          icon="calendar"
          title="Nenhuma atualização em andamento"
          action={
            <Link to="/planejamento" className={buttonClasses()}>
              Ir para Planejamento
            </Link>
          }
        >
          A atualização começa quando um protocolo com data de atualização é ativado.
        </EmptyState>
      </section>
    )
  }

  const { template } = side
  const poses = posesOf(template)
  const answers = { ...cycle.answers, ...drafts }

  const resolvedAnswers = () => {
    const out: Record<string, string> = {}
    for (const q of template?.sections.flatMap((s) => s.questions) ?? []) {
      const { text } = resolveAnswer(q, Object.hasOwn(answers, q.key) ? answers[q.key] : undefined, metrics?.metrics ?? null)
      if (text.trim() !== '') out[q.key] = text.slice(0, MAX_ANSWER_LENGTH)
    }
    return out
  }

  const zip = async () => {
    if (native && typeof navigator.share !== 'function') return setMessage({ kind: 'status', text: NATIVE_ZIP_MESSAGE })
    const blob = await downloadCyclePhotos(cycle, api, poses)
    const name = `fotos-atualizacao-${cycle.periodEnd}.zip`
    const file = new File([blob], name, { type: 'application/zip' })
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Fotos da atualização' })
      } catch (e) {
        if (!isAbort(e)) throw e
      }
      return
    }
    if (native) return setMessage({ kind: 'status', text: NATIVE_ZIP_MESSAGE })
    downloadBlob(blob, name)
    setMessage({ kind: 'status', text: 'Fotos baixadas.' })
  }

  const onAction = async (action: ReviewAction) => {
    setMessage(null)
    setBusy(action)
    try {
      if (action === 'pdf') {
        flushAll()
        window.print()
      } else if (action === 'text') {
        if (!template) return
        await navigator.clipboard.writeText(answersAsText(template, answers, metrics?.metrics ?? null))
        setMessage({ kind: 'status', text: 'Texto copiado' })
      } else if (action === 'zip') {
        await zip()
      } else {
        for (const { timer } of timers.current.values()) clearTimeout(timer)
        timers.current.clear()
        await updateCycleRepo.markSent(data.db, cycle.id, resolvedAnswers(), new Date())
        setDrafts({})
        reload()
        void syncNow()
        setMessage({ kind: 'status', text: 'Atualização marcada como enviada.' })
      }
    } catch (error) {
      const text =
        action === 'zip'
          ? error instanceof PhotosDownloadError
            ? error.message
            : DOWNLOAD_FAILED_MESSAGE
          : action === 'text'
            ? 'Não foi possível copiar o texto.'
            : 'Não foi possível concluir. Tente de novo.'
      console.error('update action failed', action, error instanceof Error ? error.name : 'unknown')
      setMessage({ kind: 'alert', text })
    } finally {
      setBusy(null)
    }
  }

  const goTo = (next: Step) => {
    flushAll()
    setMessage(null)
    setStep(next)
  }

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = STEPS.findIndex((s) => s.key === step)
    const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (by === 0) return
    e.preventDefault()
    const next = STEPS[(i + by + STEPS.length) % STEPS.length]!
    goTo(next.key)
    e.currentTarget.querySelector<HTMLElement>(`#update-tab-${next.key}`)?.focus()
  }

  const today = localDate()
  const notesTo = cycle.periodEnd < today ? cycle.periodEnd : today

  return (
    <section className="grid gap-6">
      {header}

      <div
        role="tablist"
        aria-label="Etapas da atualização"
        onKeyDown={onTabKey}
        className="grid grid-cols-3 gap-1 rounded-control border border-line bg-raised p-1"
      >
        {STEPS.map((s, i) => {
          const selected = s.key === step
          return (
            <button
              key={s.key}
              id={`update-tab-${s.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`update-panel-${s.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => goTo(s.key)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2 text-center text-sm leading-tight focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                selected ? 'bg-surface font-semibold text-ink shadow-card' : 'font-medium text-muted hover:text-ink'
              }`}
            >
              <span aria-hidden="true" className={`hidden tabular-nums sm:inline ${selected ? 'text-accent' : ''}`}>
                {i + 1}.
              </span>
              {s.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`update-panel-${step}`} aria-labelledby={`update-tab-${step}`}>
        {step === 'photos' && (
          <PhotosStep
            cycle={cycle}
            poses={poses}
            thumbs={side.thumbs}
            pending={side.pending}
            overlayFor={overlayFor}
            onCapture={onCapture}
            error={photoError}
          />
        )}
        {step === 'questions' &&
          (template ? (
            <QuestionsStep
              template={template}
              answers={cycle.answers}
              drafts={drafts}
              metrics={metrics}
              recalculating={recalculating}
              onChange={onChange}
              onRecalculate={(key) => void onRecalculate(key)}
              onOpenNotes={() => setNotesOpen(true)}
            />
          ) : (
            <NoTemplate />
          ))}
        {step === 'review' && (
          <ReviewStep
            template={template}
            cycle={cycle}
            answers={answers}
            metrics={metrics}
            native={native}
            busy={busy}
            message={message}
            onAction={(a) => void onAction(a)}
          />
        )}
      </div>

      {message?.kind === 'alert' && step !== 'review' && (
        <p role="alert" className="text-sm text-danger">
          {message.text}
        </p>
      )}

      {notesOpen && <CycleNotesSheet db={data.db} from={cycle.periodStart} to={notesTo} onClose={() => setNotesOpen(false)} />}

      {template && !native && (
        <QuestionnairePrint template={template} answers={answers} metrics={metrics?.metrics ?? null} period={{ start: cycle.periodStart, end: cycle.periodEnd }} />
      )}
    </section>
  )
}
