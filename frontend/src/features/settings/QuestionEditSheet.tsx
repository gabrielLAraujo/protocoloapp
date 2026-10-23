import { useId, useState, type FormEvent } from 'react'
import {
  acceptsCategories,
  acceptsGroups,
  acceptsWeek,
  FILL_METRICS,
  isFillMetric,
  ITEM_CATEGORIES,
  MAX_FILL_WEEK,
  MIN_FILL_WEEK,
  type ItemCategory,
} from '../../domain/fillMetrics'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, muscleGroupFromApi, muscleGroupToApi } from '../../domain/muscleGroups'
import {
  MAX_DEFAULT_LENGTH,
  QUESTION_KINDS,
  type FillOptions,
  type QuestionKind,
  type TemplateQuestion,
} from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { ACTION_ROW } from '../../ui/styles'
import { inputClass } from '../plans/styles'
import { CATEGORY_LABELS } from '../plans/labels'
import { FILL_LABELS, KIND_LABELS } from './templateFile'

const NO_FILL = ''
const WHOLE_CYCLE = ''
const WEEKS = Array.from({ length: MAX_FILL_WEEK - MIN_FILL_WEEK + 1 }, (_, i) => MIN_FILL_WEEK + i)

/** The options the chosen metric takes, in the order of their lists; null when none is left. */
function fillOptionsFor(fill: string, week: string, categories: string[], groups: string[]): FillOptions | null {
  const options: FillOptions = {}
  if (acceptsWeek(fill) && week !== WHOLE_CYCLE) options.week = Number(week)
  if (acceptsCategories(fill)) {
    const list = ITEM_CATEGORIES.filter((c) => categories.includes(c))
    if (list.length > 0) options.categories = list
  }
  if (acceptsGroups(fill)) {
    const list = MUSCLE_GROUPS.map(muscleGroupToApi).filter((g) => groups.includes(g))
    if (list.length > 0) options.groups = list
  }
  return Object.keys(options).length > 0 ? options : null
}

const toggle = (list: string[], value: string, on: boolean) => (on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value))

/** A group of checkboxes (a fieldset named by its legend). */
function CheckGroup({
  legend,
  hint,
  values,
  labels,
  checked,
  onChange,
}: {
  legend: string
  hint: string
  values: readonly string[]
  labels: (value: string) => string
  checked: string[]
  onChange(next: string[]): void
}) {
  const hintId = useId()
  return (
    <fieldset className="grid gap-2" aria-describedby={hintId}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-4">
        {values.map((v) => (
          <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked.includes(v)}
              onChange={(e) => onChange(toggle(checked, v, e.target.checked))}
              className="size-5 accent-accent"
            />
            {labels(v)}
          </label>
        ))}
      </div>
      <p id={hintId} className="text-sm text-muted">
        {hint}
      </p>
    </fieldset>
  )
}

const groupLabel = (wire: string) => {
  const group = muscleGroupFromApi(wire)
  return group ? MUSCLE_GROUP_LABELS[group] : wire
}

type Errors = Partial<Record<'text' | 'options', string>>

const FILL_GROUP_VALUES = MUSCLE_GROUPS.map(muscleGroupToApi)

function validate(text: string, kind: QuestionKind, options: string[]): Errors {
  const errors: Errors = {}
  if (text.length < 1 || text.length > 1000) errors.text = 'Escreva a pergunta (até 1000 caracteres).'
  if (kind === 'choice' && (options.length < 2 || options.length > 20 || options.some((o) => o.length > 120)))
    errors.options = 'Informe de 2 a 20 opções, uma por linha, com até 120 caracteres cada.'
  return errors
}

/**
 * The edit sheet of one question of the template: its text, kind, options (choice), initial value, the metric that fills
 * it and that metric's parameters (week, categories, groups), each shown only when the metric takes it.
 */
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
  const [initial, setInitial] = useState(question.default ?? '')
  const [week, setWeek] = useState(question.fillOptions?.week != null ? String(question.fillOptions.week) : WHOLE_CYCLE)
  const [categories, setCategories] = useState<string[]>(question.fillOptions?.categories ?? [])
  const [groups, setGroups] = useState<string[]>(question.fillOptions?.groups ?? [])
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
    if (initial.trim() !== '') saved.default = initial
    if (isFillMetric(fill)) {
      saved.fill = fill
      const fillOptions = fillOptionsFor(fill, week, categories, groups)
      if (fillOptions) saved.fillOptions = fillOptions
    }
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
          <label htmlFor={`${id}-default`} className="text-sm font-medium">
            Valor inicial
          </label>
          <textarea
            id={`${id}-default`}
            value={initial}
            rows={2}
            maxLength={MAX_DEFAULT_LENGTH}
            onChange={(e) => setInitial(e.target.value)}
            aria-describedby={`${id}-default-hint`}
            className={`${inputClass} resize-y`}
          />
          <p id={`${id}-default-hint`} className="text-sm text-muted">
            A resposta começa com este texto quando não há cálculo, e continua editável.
          </p>
        </div>

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

        {acceptsWeek(fill) && (
          <div className="grid gap-2">
            <label htmlFor={`${id}-week`} className="text-sm font-medium">
              Semana
            </label>
            <select id={`${id}-week`} value={week} onChange={(e) => setWeek(e.target.value)} className={inputClass}>
              <option value={WHOLE_CYCLE}>Ciclo todo</option>
              {WEEKS.map((w) => (
                <option key={w} value={String(w)}>
                  Semana {w}
                </option>
              ))}
            </select>
          </div>
        )}

        {acceptsCategories(fill) && (
          <CheckGroup
            legend="Categorias"
            hint="Só os itens dessas categorias. Nenhuma marcada: todos os itens."
            values={ITEM_CATEGORIES}
            labels={(c) => CATEGORY_LABELS[c as ItemCategory] ?? c}
            checked={categories}
            onChange={setCategories}
          />
        )}

        {acceptsGroups(fill) && (
          <CheckGroup
            legend="Grupos"
            hint="Só esses grupos musculares. Nenhum marcado: todos os grupos."
            values={FILL_GROUP_VALUES}
            labels={groupLabel}
            checked={groups}
            onChange={setGroups}
          />
        )}

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
