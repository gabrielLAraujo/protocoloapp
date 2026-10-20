import type { WorkoutDocument } from '../../../domain/planDocuments'
import { DiffList, type PlanDiff } from '../DiffList'
import { isLowConfidence } from '../docEdit'
import { Section } from '../fields'
import { buttonClass } from '../styles'
import { describePath, type Issue } from '../validation'
import { dayLabel } from './steps'

type Props = {
  doc: WorkoutDocument
  newCount: number
  confirmed: ReadonlySet<string>
  lowConfidence: readonly string[]
  diff: PlanDiff | null
  issues: readonly Issue[]
  online: boolean
  catalogState: 'loading' | 'ready' | 'failed'
  working: 'saving' | 'activating' | null
  saved: boolean
  onJumpToDay(dayIndex: number): void
  onSaveDraft(): void
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Last step: what is about to be activated, what is still open, and the changes against the active plan. */
export function ActivateStep({ doc, newCount, confirmed, lowConfidence, diff, issues, online, catalogState, working, saved, onJumpToDay, onSaveDraft }: Props) {
  const exercises = doc.days.reduce((sum, d) => sum + d.exercises.length, 0)
  const pendingDays = doc.days.map((d, i) => ({ day: d, i })).filter(({ day }) => !confirmed.has(day.key))
  const pendingConfira = pendingDays.reduce(
    (sum, { day, i }) => sum + day.exercises.filter((_, j) => isLowConfidence(lowConfidence, `days[${i}].exercises[${j}]`)).length,
    0,
  )
  const stats: [number, string][] = [
    [doc.days.length, doc.days.length === 1 ? 'dia' : 'dias'],
    [exercises, exercises === 1 ? 'exercício' : 'exercícios'],
    [newCount, newCount === 1 ? 'novo' : 'novos'],
    [pendingConfira, 'para conferir'],
  ]

  return (
    <div className="grid gap-4">
      <dl aria-label="Resumo do treino" className="grid grid-cols-2 gap-2">
        {stats.map(([n, label]) => (
          <div key={label} className="flex items-baseline gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
            <dt className="order-2 text-sm text-muted">{label}</dt>
            <dd className="order-1 text-xl font-bold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      {pendingDays.length > 0 ? (
        <Section title="Falta confirmar">
          <p className="text-sm text-muted">{plural(pendingDays.length, 'dia ainda não foi confirmado', 'dias ainda não foram confirmados')}. Ativar só libera com todos confirmados.</p>
          <ul className="grid gap-2">
            {pendingDays.map(({ i }) => (
              <li key={i}>
                <button type="button" className={`${buttonClass} w-full justify-between`} onClick={() => onJumpToDay(i)}>
                  <span className="truncate">{dayLabel(doc, i)}</span>
                  <span className="text-accent">Revisar</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <p className="text-sm text-muted">Todos os dias foram confirmados.</p>
      )}

      {issues.length > 0 && (
        <div id="wizard-issues" className="grid gap-1 text-sm text-danger">
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
      {!online && <p className="text-sm text-muted">Conecte-se à internet para ativar</p>}
      {catalogState === 'loading' && <p className="text-sm text-muted">Carregando catálogo…</p>}
      {catalogState === 'failed' && (
        <p role="alert" className="text-sm text-danger">
          Não foi possível ler o catálogo de exercícios do aparelho.
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ok">
          Rascunho salvo
        </p>
      )}
      <div>
        <button type="button" className={buttonClass} disabled={!online || working !== null || catalogState !== 'ready'} onClick={onSaveDraft}>
          {working === 'saving' ? 'Salvando…' : 'Salvar rascunho'}
        </button>
      </div>

      <Section title="O que mudou">
        <DiffList diff={diff} />
      </Section>
    </div>
  )
}
