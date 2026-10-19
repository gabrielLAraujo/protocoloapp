import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useData } from '../../data/dataContext'
import { planRepo, type PlanKind, type PlanVersionLocal } from '../../data/planRepo'
import { parseProtocolDocument, parseWorkoutDocument } from '../../domain/planDocuments'
import { useSync } from '../sync/syncContext'
import { CycleDatesForm } from './CycleDatesForm'
import { formatDayMonth, formatInstantDayMonth } from './labels'
import { ImportError, OFFLINE_IMPORT_MESSAGE, uploadPdf, type UploadStage } from './uploadPdf'

type Loaded = Record<PlanKind, { active: PlanVersionLocal | null; draft: PlanVersionLocal | null }>

const KIND_TITLES: Record<PlanKind, string> = { protocol: 'Protocolo', workout: 'Treino' }

async function load(data: NonNullable<ReturnType<typeof useData>>): Promise<Loaded> {
  const pick = async (kind: PlanKind) => {
    const [active, all] = await Promise.all([planRepo.getActive(data.db, kind), planRepo.list(data.db, kind)])
    return { active, draft: all.find((p) => p.status === 'draft') ?? null }
  }
  const [protocol, workout] = await Promise.all([pick('protocol'), pick('workout')])
  return { protocol, workout }
}

function describe(kind: PlanKind, plan: PlanVersionLocal): string[] {
  const lines: string[] = []
  if (kind === 'protocol') {
    const parsed = parseProtocolDocument(plan.document)
    if (parsed.ok) {
      if (parsed.value.phaseName) lines.push(parsed.value.phaseName)
      if (parsed.value.updateDate) lines.push(`Atualização em ${formatDayMonth(parsed.value.updateDate)}`)
    }
  } else {
    const parsed = parseWorkoutDocument(plan.document)
    if (parsed.ok) lines.push(`${parsed.value.days.length} ${parsed.value.days.length === 1 ? 'dia de treino' : 'dias de treino'}`)
  }
  if (plan.activatedAt) lines.push(`Ativo desde ${formatInstantDayMonth(plan.activatedAt)}`)
  return lines
}

export function PlansPage() {
  const data = useData()
  const { online, dataVersion } = useSync()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<{ kind: PlanKind; stage: UploadStage } | null>(null)
  // When the server started reading (Date.now()) and the clock that ticks while it does.
  const [readingSince, setReadingSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<{ kind: PlanKind; message: string } | null>(null)
  const [editingDates, setEditingDates] = useState(false)
  // Synchronous guard: two quick picks must not start two imports (state updates are not visible yet).
  const importing = useRef(false)
  // The import outlives a tap elsewhere: when it ends, only a page still on screen may take the user to the review.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    load(data)
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
      .catch((e: unknown) => {
        console.error('could not read the plans', e)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])

  useEffect(() => {
    if (readingSince === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [readingSince])
  const elapsed = readingSince === null ? 0 : Math.max(0, Math.floor((now - readingSince) / 1000))

  const send = async (kind: PlanKind, file: File | undefined) => {
    if (!file || importing.current) return
    importing.current = true
    setError(null)
    setBusy({ kind, stage: 'uploading' })
    try {
      const id = await uploadPdf(kind, file, (stage) => {
        if (stage === 'reading') {
          setReadingSince(Date.now())
          setNow(Date.now())
        }
        setBusy({ kind, stage })
      })
      if (mounted.current) void navigate(`/planejamento/revisao/${id}`)
    } catch (e) {
      setError({ kind, message: e instanceof ImportError ? e.message : 'Não foi possível importar o PDF. Tente novamente.' })
    } finally {
      importing.current = false
      setReadingSince(null)
      setBusy(null)
    }
  }

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Planejamento</h1>
      {!online && <p className="text-sm text-muted">{OFFLINE_IMPORT_MESSAGE}</p>}
      {(['protocol', 'workout'] as const).map((kind) => {
        const { active, draft } = loaded[kind]
        const title = KIND_TITLES[kind]
        const mine = busy?.kind === kind ? busy : null
        return (
          <section key={kind} aria-label={title} className="grid gap-3 rounded-control border border-line bg-surface p-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            {active ? (
              <ul className="grid gap-0.5 text-sm text-muted">
                {describe(kind, active).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhuma versão ativa.</p>
            )}

            {mine && (
              <p role="status" className="text-sm">
                {mine.stage === 'uploading' ? (
                  'Enviando o PDF…'
                ) : (
                  <>
                    Lendo o PDF… {elapsed} s
                    <span className="block text-muted">Pode demorar até 90 segundos. Não feche esta tela.</span>
                  </>
                )}
              </p>
            )}
            {error?.kind === kind && (
              <p role="alert" className="text-sm text-danger">
                {error.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <UploadButton disabled={busy !== null || !online} onPick={(file) => void send(kind, file)} />
              {kind === 'protocol' && active && (
                <Link to="/planejamento/protocolo" className={linkButton}>
                  Ver protocolo
                </Link>
              )}
              {kind === 'protocol' && active && (
                <button type="button" className={linkButton} aria-expanded={editingDates} onClick={() => setEditingDates((v) => !v)}>
                  Editar datas
                </button>
              )}
              {draft && (
                <Link to={`/planejamento/revisao/${draft.id}`} className={linkButton}>
                  Revisar rascunho
                </Link>
              )}
            </div>
            {kind === 'protocol' && active && editingDates && <ProtocolDates plan={active} onSaved={() => setEditingDates(false)} />}
          </section>
        )
      })}
    </div>
  )
}

const linkButton =
  'grid min-h-11 place-items-center rounded-control border border-line px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent'

function UploadButton({ disabled, onPick }: { disabled: boolean; onPick: (file: File | undefined) => void }): ReactNode {
  return (
    <label
      className={`relative grid min-h-11 cursor-pointer place-items-center rounded-control bg-accent px-4 text-sm font-semibold text-on-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input
        type="file"
        accept="application/pdf"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0])
          e.target.value = '' // the same file can be picked again
        }}
      />
      <span>Enviar novo PDF</span>
    </label>
  )
}

function ProtocolDates({ plan, onSaved }: { plan: PlanVersionLocal; onSaved: () => void }) {
  const parsed = parseProtocolDocument(plan.document)
  const doc = parsed.ok ? parsed.value : null
  return (
    <div className="border-t border-line pt-3">
      <CycleDatesForm planId={plan.id} updateDate={doc?.updateDate ?? null} billingDate={doc?.billingDate ?? null} onSaved={onSaved} />
    </div>
  )
}
