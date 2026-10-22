import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../../api/client'
import { catalogRepo } from '../../data/catalogRepo'
import { useData } from '../../data/dataContext'
import { exerciseRepo } from '../../data/exerciseRepo'
import { planRepo, type PlanKind, type PlanVersionLocal } from '../../data/planRepo'
import { parseProtocolDocument, parseWorkoutDocument } from '../../domain/planDocuments'
import { useSync } from '../sync/syncContext'
import { CycleDatesForm } from './CycleDatesForm'
import { formatDayMonth, formatInstantDayMonth } from './labels'
import { localDate } from '../checkin/localDate'
import { createDeviceDraft, fileBytes, readOnDevice } from './importPlan'
import { ImportError, OFFLINE_IMPORT_MESSAGE, uploadPdf, type UploadStage } from './uploadPdf'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'

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

  const send = async (kind: PlanKind, file: File | undefined) => {
    if (!file || importing.current) return
    importing.current = true
    setError(null)
    setBusy({ kind, stage: 'uploading' })
    try {
      const fileId = await uploadPdf(kind, file, (stage) => setBusy({ kind, stage }))
      // Read on the device: the same file the storage now keeps, so the review can still offer the AI on it.
      setBusy({ kind, stage: 'reading' })
      // The exercise catalog is refreshed alongside (the review searches it and shows the GIFs); it never rejects.
      const refreshing = data ? catalogRepo.refresh(data.db, api) : undefined
      const known = data ? await exerciseRepo.all(data.db).catch(() => []) : []
      const reading = await readOnDevice(kind, await fileBytes(file), localDate(), known)
      await refreshing
      const { id, notice } = await createDeviceDraft(kind, fileId, reading)
      if (mounted.current) void navigate(`/planejamento/revisao/${id}`, { state: notice ? { notice } : null })
    } catch (e) {
      setError({ kind, message: e instanceof ImportError ? e.message : 'Não foi possível importar o PDF. Tente novamente.' })
    } finally {
      importing.current = false
      setBusy(null)
    }
  }

  if (failed) return <p className="text-muted">Não foi possível abrir os dados do aparelho.</p>
  if (!data || !loaded) return <p className="text-muted">Carregando…</p>

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-bold">Planejamento</h1>
      {!online && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Icon name="offline" size={18} />
          <span>{OFFLINE_IMPORT_MESSAGE}</span>
        </p>
      )}
      {/* The protocol and the workout side by side on the desktop. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {(['protocol', 'workout'] as const).map((kind) => {
          const { active, draft } = loaded[kind]
          const title = KIND_TITLES[kind]
          const mine = busy?.kind === kind ? busy : null
          return (
            <section key={kind} aria-label={title} className={cardClasses({ className: 'grid gap-4' })}>
              <div className="flex items-start gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <h2 className="text-lg font-semibold text-ink">{title}</h2>
                  {active ? (
                    <ul className="grid gap-1 text-sm text-muted">
                      {describe(kind, active).map((line) =>
                        line.startsWith('Ativo desde') ? (
                          <li key={line} className="pt-1">
                            <Chip tone="ok" icon="check">
                              {line}
                            </Chip>
                          </li>
                        ) : (
                          <li key={line} className="tabular-nums">
                            {line}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Nenhuma versão ativa.</p>
                  )}
                </div>
              </div>

              {mine && (
                <p role="status" className="rounded-control bg-raised px-3 py-2 text-sm font-medium tabular-nums">
                  {mine.stage === 'uploading' ? 'Enviando o PDF…' : 'Lendo o PDF…'}
                </p>
              )}
              {error?.kind === kind && (
                <p role="alert" className="text-sm text-danger">
                  {error.message}
                </p>
              )}

              {/*
                Actions: the upload first, across the card; the others in equal halves below it (an odd one out takes the
                whole row), so nothing wraps alone at any width. The same grid on the desktop, where the card is half wide.
              */}
              <div data-plan-actions className="grid grid-cols-2 gap-2 border-t border-line pt-4 [&>*:first-child]:col-span-2 [&>*:last-child:nth-child(even)]:col-span-2">
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
    </div>
  )
}

const linkButton = buttonClasses({ variant: 'secondary' })

function UploadButton({ disabled, onPick }: { disabled: boolean; onPick: (file: File | undefined) => void }): ReactNode {
  return (
    <label
      className={buttonClasses({
        variant: 'primary',
        className: `relative cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${disabled ? 'pointer-events-none opacity-50' : ''}`,
      })}
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
      <Icon name="upload" size={18} />
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
