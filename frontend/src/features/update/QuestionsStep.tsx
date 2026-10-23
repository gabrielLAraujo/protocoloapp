import { useId } from 'react'
import { Link } from 'react-router'
import type { QuestionnaireTemplate, TemplateQuestion } from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { EmptyState } from '../../ui/EmptyState'
import { GROUP_LABEL, buttonClasses, cardClasses } from '../../ui/styles'
import { inputClass } from '../plans/styles'
import { resolveAnswer } from './answers'
import type { LoadedMetrics } from './metricsCache'
import { dayMonth } from './updateFormat'

/** The empty state of a cycle without a questionnaire template: it is imported in Configurações. */
export function NoTemplate() {
  return (
    <EmptyState
      icon="note"
      title="Nenhum questionário ainda"
      action={
        <Link to="/configuracoes/questionario" className={buttonClasses({ variant: 'primary' })}>
          Importe o modelo em Configurações
        </Link>
      }
    >
      O questionário de cada atualização sai do modelo que você importa uma vez.
    </EmptyState>
  )
}

interface FieldProps {
  question: TemplateQuestion
  value: string
  onChange(text: string): void
  describedBy?: string
}

function AnswerField({ question, value, onChange, describedBy, labelId }: FieldProps & { labelId: string }) {
  if (question.kind === 'choice' && !question.fill) {
    return (
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} className="flex flex-wrap gap-2">
        {(question.options ?? []).map((option) => (
          <label key={option} className="min-w-0">
            <input
              type="radio"
              name={question.key}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <span className="grid min-h-11 cursor-pointer place-items-center rounded-control border border-control-line bg-surface px-3 text-sm font-medium transition-colors hover:bg-raised peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {option}
            </span>
          </label>
        ))}
      </div>
    )
  }
  const common = {
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    maxLength: 4000,
  }
  // A calculated answer can run over several lines: always a text area.
  if (question.kind === 'long_text' || question.fill) return <textarea {...common} rows={question.fill ? 4 : 5} className={`${inputClass} resize-y leading-relaxed`} />
  if (question.kind === 'number') return <input {...common} type="text" inputMode="decimal" className={`${inputClass} max-w-40 tabular-nums`} />
  return <input {...common} type="text" className={inputClass} />
}

function QuestionBlock({
  question,
  stored,
  draft,
  metrics,
  onChange,
  onRecalculate,
  onOpenNotes,
  recalculating,
}: {
  question: TemplateQuestion
  stored: string | undefined
  draft: string | undefined
  metrics: LoadedMetrics | null
  onChange(text: string): void
  onRecalculate(): void
  onOpenNotes(): void
  recalculating: boolean
}) {
  const labelId = useId()
  const hintId = useId()
  const resolved = resolveAnswer(question, draft ?? stored, metrics?.metrics ?? null)
  const calculated = draft === undefined && resolved.source === 'calculated'
  const noMetrics = !!question.fill && !metrics && resolved.source === 'empty'
  return (
    <div className="grid gap-2 p-4">
      <p id={labelId} className="text-base font-medium [overflow-wrap:anywhere]">
        {question.text}
      </p>
      <AnswerField question={question} value={resolved.text} onChange={onChange} labelId={labelId} describedBy={noMetrics ? hintId : undefined} />
      {noMetrics && (
        <p id={hintId} className="text-sm text-muted">
          Sem cálculo ainda: conecte-se para calcular.
        </p>
      )}
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        {question.fill ? (
          <>
            {calculated && <Chip icon="check">Calculado</Chip>}
            <Button variant="ghost" size="sm" icon="sync" className="-ml-1" loading={recalculating} onClick={onRecalculate}>
              Recalcular
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon="note" className="-ml-1" onClick={onOpenNotes}>
            Ver notas do ciclo
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Questionário: the template's sections. A question with `fill` comes answered from the metrics (the "Calculado"
 * label) and can be edited (the edit wins) or recalculated; the others are free fields with the cycle's notes at hand.
 */
export function QuestionsStep({
  template,
  answers,
  drafts,
  metrics,
  recalculating,
  onChange,
  onRecalculate,
  onOpenNotes,
}: {
  template: QuestionnaireTemplate
  answers: Record<string, string>
  drafts: Record<string, string>
  metrics: LoadedMetrics | null
  recalculating: string | null
  onChange(key: string, text: string): void
  onRecalculate(key: string): void
  onOpenNotes(): void
}) {
  return (
    <div className="grid gap-5">
      {metrics?.cached && (
        <p role="status" className="text-sm text-muted">
          Sem conexão. Calculado em {dayMonth(metrics.fetchedAt)}.
        </p>
      )}
      {template.sections.map((section, i) => (
        <section key={`${i}-${section.title}`} className="grid gap-2" aria-labelledby={`update-section-${i}`}>
          <h2 id={`update-section-${i}`} className={GROUP_LABEL}>
            {section.title}
          </h2>
          <div className={cardClasses({ tone: 'list' })}>
            {section.questions.map((q) => (
              <QuestionBlock
                key={q.key}
                question={q}
                stored={Object.hasOwn(answers, q.key) ? answers[q.key] : undefined}
                draft={Object.hasOwn(drafts, q.key) ? drafts[q.key] : undefined}
                metrics={metrics}
                recalculating={recalculating === q.key}
                onChange={(text) => onChange(q.key, text)}
                onRecalculate={() => onRecalculate(q.key)}
                onOpenNotes={onOpenNotes}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
