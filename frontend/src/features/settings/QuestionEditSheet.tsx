import { useId, useState, type FormEvent } from 'react'
import { FILL_METRICS, isFillMetric } from '../../domain/fillMetrics'
import { QUESTION_KINDS, type QuestionKind, type TemplateQuestion } from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { ACTION_ROW } from '../../ui/styles'
import { inputClass } from '../plans/styles'
import { FILL_LABELS, KIND_LABELS } from './templateFile'

const NO_FILL = ''

type Errors = Partial<Record<'text' | 'options', string>>

function validate(text: string, kind: QuestionKind, options: string[]): Errors {
  const errors: Errors = {}
  if (text.length < 1 || text.length > 1000) errors.text = 'Escreva a pergunta (até 1000 caracteres).'
  if (kind === 'choice' && (options.length < 2 || options.length > 20 || options.some((o) => o.length > 120)))
    errors.options = 'Informe de 2 a 20 opções, uma por linha, com até 120 caracteres cada.'
  return errors
}

/** The edit sheet of one question of the template: its text, kind, options (choice) and the metric that fills it. */
export function QuestionEditSheet({
  question,
  busy,
  onSave,
  onCancel,
}: {
  question: TemplateQuestion
  busy: boolean
  onSave(question: TemplateQuestion): void
  onCancel(): void
}) {
  const id = useId()
  const [text, setText] = useState(question.text)
  const [kind, setKind] = useState<QuestionKind>(question.kind)
  const [options, setOptions] = useState((question.options ?? []).join('\n'))
  const [fill, setFill] = useState<string>(question.fill ?? NO_FILL)
  const [errors, setErrors] = useState<Errors>({})

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const trimmed = text.trim()
    const optionList = options
      .split('\n')
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
    const next = validate(trimmed, kind, optionList)
    setErrors(next)
    if (next.text || next.options) return
    const saved: TemplateQuestion = { key: question.key, text: trimmed, kind }
    if (kind === 'choice') saved.options = optionList
    if (isFillMetric(fill)) saved.fill = fill
    onSave(saved)
  }

  const describedBy = (field: keyof Errors, hint?: string) => [errors[field] ? `${id}-${field}-error` : null, hint].filter(Boolean).join(' ') || undefined

  return (
    <Sheet title="Editar pergunta" onCancel={onCancel} focusTitle>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-2">
          <label htmlFor={`${id}-text`} className="text-sm font-medium">
            Pergunta
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            rows={3}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={errors.text ? true : undefined}
            aria-describedby={describedBy('text')}
            className={`${inputClass} resize-y`}
          />
          {errors.text && (
            <p id={`${id}-text-error`} role="alert" className="text-sm text-danger">
              {errors.text}
            </p>
          )}
          <p className="text-sm text-muted">
            Chave <span className="font-medium text-ink">{question.key}</span>: liga a pergunta às respostas e não muda.
          </p>
        </div>

        <div className="grid gap-2">
          <label htmlFor={`${id}-kind`} className="text-sm font-medium">
            Tipo de resposta
          </label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)} className={inputClass}>
            {QUESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        {kind === 'choice' && (
          <div className="grid gap-2">
            <label htmlFor={`${id}-options`} className="text-sm font-medium">
              Opções
            </label>
            <textarea
              id={`${id}-options`}
              value={options}
              rows={4}
              onChange={(e) => setOptions(e.target.value)}
              aria-invalid={errors.options ? true : undefined}
              aria-describedby={describedBy('options', `${id}-options-hint`)}
              className={`${inputClass} resize-y`}
            />
            <p id={`${id}-options-hint`} className="text-sm text-muted">
              Uma opção por linha.
            </p>
            {errors.options && (
              <p id={`${id}-options-error`} role="alert" className="text-sm text-danger">
                {errors.options}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-2">
          <label htmlFor={`${id}-fill`} className="text-sm font-medium">
            Preencher com
          </label>
          <select
            id={`${id}-fill`}
            value={fill}
            onChange={(e) => setFill(e.target.value)}
            aria-describedby={`${id}-fill-hint`}
            className={inputClass}
          >
            <option value={NO_FILL}>Nenhuma</option>
            {FILL_METRICS.map((m) => (
              <option key={m} value={m}>
                {FILL_LABELS[m]}
              </option>
            ))}
          </select>
          <p id={`${id}-fill-hint`} className="text-sm text-muted">
            Com uma métrica, a resposta já vem calculada com os dados do ciclo e continua editável.
          </p>
        </div>

        <div className={ACTION_ROW}>
          <Button variant="primary" type="submit" loading={busy}>
            Salvar
          </Button>
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Sheet>
  )
}
