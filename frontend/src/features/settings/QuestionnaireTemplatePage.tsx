import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import type { LocalDb } from '../../data/localDb'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { updateCycleRepo } from '../../data/updateCycleRepo'
import {
  BODYBUILDING_POSES,
  posesOf,
  usesBodybuildingPoses,
  type Pose,
  type QuestionnaireTemplate,
  type TemplateQuestion,
} from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { SectionHeader } from '../../ui/SectionHeader'
import { Sheet } from '../../ui/Sheet'
import { ACTION_ROW, GROUP_LABEL, buttonClasses, cardClasses } from '../../ui/styles'
import { inputClass } from '../plans/styles'
import { useSync } from '../sync/syncContext'
import { photoQueue } from '../update/photos/photoQueue'
import { QuestionEditSheet } from './QuestionEditSheet'
import { downloadBlob, exportTemplate, FILL_LABELS, KIND_LABELS, readTemplateFile, TEMPLATE_FILE_NAME } from './templateFile'

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ok'; template: QuestionnaireTemplate | null }
type Message = { kind: 'status' | 'alert'; text: string }
type Editing = { section: number; index: number }

/** Swaps the item at `index` with its neighbor `by` (−1 up, +1 down). */
function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const next = [...list]
  const target = index + by
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/** Saves with the device clock (outside the component: the clock is read when the user acts, never while rendering). */
const storeTemplate = (db: LocalDb, t: QuestionnaireTemplate) => questionnaireTemplateRepo.save(db, t, new Date())

/** Whether the open (not sent) update already has photos, sent or still in the queue. */
async function openUpdateHasPhotos(db: LocalDb): Promise<boolean> {
  const cycle = await updateCycleRepo.current(db)
  if (!cycle || cycle.status === 'sent') return false
  if (cycle.photos.length > 0) return true
  // No IndexedDB (a locked-down browser): nothing can be queued either.
  const queued = await photoQueue.list().catch(() => [])
  return queued.some((p) => p.cycleId === cycle.id)
}

const without = (drafts: Record<string, string>, key: string) => Object.fromEntries(Object.entries(drafts).filter(([k]) => k !== key))

const ICON_BUTTON = buttonClasses({ variant: 'ghost', size: 'sm', className: 'w-11 px-0 text-muted hover:text-accent' })

/** Up/down buttons of one row; the first can't go up, the last can't go down. */
function MoveButtons({ index, count, what, onMove }: { index: number; count: number; what: string; onMove(by: -1 | 1): void }) {
  return (
    <div className="flex shrink-0">
      <button type="button" className={ICON_BUTTON} aria-label={`Subir ${what}`} disabled={index === 0} onClick={() => onMove(-1)}>
        <Icon name="chevronLeft" size={18} className="rotate-90" />
      </button>
      <button type="button" className={ICON_BUTTON} aria-label={`Descer ${what}`} disabled={index === count - 1} onClick={() => onMove(1)}>
        <Icon name="chevronRight" size={18} className="rotate-90" />
      </button>
    </div>
  )
}

/** The file picker of the import, kept a `<label>` so it looks like the other buttons. */
function ImportButton({ primary, onPick }: { primary: boolean; onPick(file: File): void }): ReactNode {
  return (
    <label
      className={buttonClasses({
        variant: primary ? 'primary' : 'secondary',
        className: 'relative cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
      })}
    >
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // the same file can be picked again
          if (file) onPick(file)
        }}
      />
      <Icon name="upload" size={18} />
      <span>Importar JSON</span>
    </label>
  )
}

function questionSubtitle(q: TemplateQuestion) {
  return q.fill ? `${KIND_LABELS[q.kind]} · Preenche com: ${FILL_LABELS[q.fill]}` : KIND_LABELS[q.kind]
}

/** Configurações → Questionário de atualização: the template's questions, their order and fill, the poses, import and export. */
export function QuestionnaireTemplatePage() {
  const data = useData()
  const { syncNow, dataVersion } = useSync()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [message, setMessage] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [replacing, setReplacing] = useState<QuestionnaireTemplate | null>(null)
  // The confirmation of "Usar poses do fisiculturismo", with whether the open update already has photos.
  const [switchingPoses, setSwitchingPoses] = useState<{ hasPhotos: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // A pose label being typed; saved when the field is left.
  const [poseDrafts, setPoseDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!data) return
    let cancelled = false
    questionnaireTemplateRepo
      .get(data.db)
      .then((row) => {
        if (!cancelled) setLoaded({ status: 'ok', template: row?.document ?? null })
      })
      .catch((error: unknown) => {
        console.error('could not read the questionnaire template', error instanceof Error ? error.name : 'unknown')
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])

  if (!data || loaded.status === 'loading') return <p className="text-muted">Carregando…</p>
  if (loaded.status === 'error') return <p role="alert">Não foi possível ler o modelo do questionário.</p>

  const { db } = data
  const template = loaded.template

  /** Stores the whole template, shows it again and syncs. Returns whether it was saved. */
  const save = async (next: QuestionnaireTemplate, done: string): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      await storeTemplate(db, next)
      const row = await questionnaireTemplateRepo.get(db)
      setLoaded({ status: 'ok', template: row?.document ?? next })
      setMessage({ kind: 'status', text: done })
      void syncNow()
      return true
    } catch (error) {
      // Never the template's text: only the kind of failure.
      console.error('could not save the questionnaire template', error instanceof Error ? error.name : 'unknown')
      setMessage({ kind: 'alert', text: 'Não foi possível salvar o modelo. Tente de novo.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (file: File) => {
    setMessage(null)
    const result = await readTemplateFile(file)
    if (!result.ok) {
      setMessage({ kind: 'alert', text: result.message })
      return
    }
    if (template) setReplacing(result.value)
    else await save(result.value, 'Modelo importado.')
  }

  const exportFile = () => {
    if (!template) return
    downloadBlob(exportTemplate(template), TEMPLATE_FILE_NAME)
    setMessage({ kind: 'status', text: 'Modelo exportado.' })
  }

  const withSections = (t: QuestionnaireTemplate, sections: QuestionnaireTemplate['sections']) => ({ ...t, sections })
  const moveQuestion = (t: QuestionnaireTemplate, s: number, i: number, by: -1 | 1) =>
    void save(withSections(t, t.sections.map((sec, k) => (k === s ? { ...sec, questions: moved(sec.questions, i, by) } : sec))), 'Ordem salva.')
  const saveQuestion = async (t: QuestionnaireTemplate, { section, index }: Editing, q: TemplateQuestion) => {
    const sections = t.sections.map((sec, k) =>
      k === section ? { ...sec, questions: sec.questions.map((old, j) => (j === index ? q : old)) } : sec,
    )
    if (await save(withSections(t, sections), 'Pergunta salva.')) setEditing(null)
  }

  const poses = posesOf(template)
  const savePoses = (t: QuestionnaireTemplate, next: Pose[], done: string) => save({ ...t, poses: next }, done)
  const commitPoseLabel = (t: QuestionnaireTemplate, index: number, pose: Pose) => {
    const draft = poseDrafts[pose.key]
    if (draft === undefined) return
    const label = draft.trim()
    const clear = () => setPoseDrafts((d) => without(d, pose.key))
    if (label === pose.label) return clear()
    if (label.length < 1 || label.length > 40) {
      clear()
      setMessage({ kind: 'alert', text: 'O rótulo da pose precisa ter de 1 a 40 caracteres.' })
      return
    }
    void savePoses(t, poses.map((p, k) => (k === index ? { ...p, label } : p)), 'Pose salva.').finally(clear)
  }

  const askBodybuildingPoses = async () => {
    setMessage(null)
    let hasPhotos = false
    try {
      hasPhotos = await openUpdateHasPhotos(db)
    } catch (error) {
      console.error('could not read the open update', error instanceof Error ? error.name : 'unknown')
    }
    setSwitchingPoses({ hasPhotos })
  }

  const editingQuestion = template && editing ? template.sections[editing.section]?.questions[editing.index] : undefined

  return (
    <section className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/configuracoes" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
          <Icon name="chevronLeft" size={18} />
          Configurações
        </Link>
        <h1 className="text-xl font-bold">Questionário de atualização</h1>
        <p className="text-sm text-muted">{template ? template.title : 'O modelo monta o questionário de cada atualização.'}</p>
      </div>

      <div className={ACTION_ROW}>
        <ImportButton primary={!template} onPick={(file) => void importFile(file)} />
        <Button icon="note" disabled={!template} onClick={exportFile}>
          Exportar JSON
        </Button>
      </div>
      {message && (
        <p role={message.kind} className={`-mt-4 text-sm ${message.kind === 'alert' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      )}

      {!template ? (
        <EmptyState icon="note" title="Nenhum modelo ainda">
          Importe o arquivo JSON com as perguntas. Depois, cada pergunta pode ser editada aqui.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-1">
            <SectionHeader title="Perguntas" />
            <div className="grid gap-5">
              {template.sections.map((section, s) => (
                <section key={`${s}-${section.title}`} aria-labelledby={`template-section-${s}`} className="grid gap-2">
                  <h2 id={`template-section-${s}`} className={GROUP_LABEL}>
                    {section.title}
                  </h2>
                  <ol className={cardClasses({ tone: 'list' })}>
                    {section.questions.map((q, i) => (
                      <li key={q.key} className="flex items-center gap-1 pr-2">
                        <button
                          type="button"
                          onClick={() => setEditing({ section: s, index: i })}
                          className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                        >
                          <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-medium text-ink [overflow-wrap:anywhere]">{q.text}</span>
                            <span className="block text-sm text-muted">{questionSubtitle(q)}</span>
                          </span>
                        </button>
                        <MoveButtons
                          index={i}
                          count={section.questions.length}
                          what={`pergunta ${i + 1} de ${section.title}`}
                          onMove={(by) => moveQuestion(template, s, i, by)}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </div>

          <section aria-labelledby="template-poses" className="grid gap-1">
            <SectionHeader
              id="template-poses"
              title="Poses das fotos"
              action={
                <Button size="sm" icon="camera" disabled={busy || usesBodybuildingPoses(poses)} onClick={() => void askBodybuildingPoses()}>
                  Usar poses do fisiculturismo
                </Button>
              }
            />
            <ol className={cardClasses({ tone: 'list' })}>
              {poses.map((pose, i) => (
                <li key={pose.key} className="flex min-h-13 items-center gap-3 py-2 pr-2 pl-4">
                  <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                  <input
                    type="text"
                    aria-label={`Rótulo da pose ${i + 1}`}
                    value={poseDrafts[pose.key] ?? pose.label}
                    maxLength={40}
                    onChange={(e) => {
                      const value = e.target.value
                      setPoseDrafts((d) => ({ ...d, [pose.key]: value }))
                    }}
                    onBlur={() => commitPoseLabel(template, i, pose)}
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <MoveButtons
                    index={i}
                    count={poses.length}
                    what={`pose ${i + 1}`}
                    onMove={(by) => void savePoses(template, moved(poses, i, by), 'Ordem salva.')}
                  />
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {template && editing && editingQuestion && (
        <QuestionEditSheet
          key={editingQuestion.key}
          question={editingQuestion}
          busy={busy}
          onSave={(q) => void saveQuestion(template, editing, q)}
          onCancel={() => setEditing(null)}
        />
      )}

      {template && switchingPoses && (
        <Sheet title="Usar poses do fisiculturismo?" onCancel={() => setSwitchingPoses(null)}>
          <p className="text-base text-ink">
            As poses do questionário passam a ser as {BODYBUILDING_POSES.length} obrigatórias do fisiculturismo:{' '}
            {BODYBUILDING_POSES.map((p) => p.label).join(', ')}.
          </p>
          {switchingPoses.hasPhotos && (
            <p className="text-sm text-muted">
              A atualização aberta já tem fotos. Elas continuam guardadas e aparecem em “Outras fotos” quando a pose sair da lista.
            </p>
          )}
          <div className={ACTION_ROW}>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void savePoses(template, BODYBUILDING_POSES.map((p) => ({ ...p })), 'Poses do fisiculturismo salvas.').then(
                  (ok) => ok && setSwitchingPoses(null),
                )
              }
            >
              Usar estas poses
            </Button>
            <Button onClick={() => setSwitchingPoses(null)}>Cancelar</Button>
          </div>
        </Sheet>
      )}

      {replacing && (
        <Sheet title="Substituir o modelo atual?" onCancel={() => setReplacing(null)}>
          <p className="text-base text-ink">As perguntas e as poses do arquivo substituem as atuais. As respostas já dadas continuam guardadas.</p>
          <div className={ACTION_ROW}>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                const next = replacing
                void save(next, 'Modelo importado.').then((ok) => ok && setReplacing(null))
              }}
            >
              Substituir
            </Button>
            <Button onClick={() => setReplacing(null)}>Cancelar</Button>
          </div>
        </Sheet>
      )}
    </section>
  )
}
