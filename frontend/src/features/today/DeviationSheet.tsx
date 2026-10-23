import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { MAX_DESCRIPTION_LENGTH, MAX_QUANTITY_LENGTH, type DietDeviationLocal } from '../../data/dietDeviationRepo'
import { clockOf } from '../../domain/targetStatus'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { ACTION_ROW } from '../../ui/styles'
import { inputClass } from '../plans/styles'
import { deviationSchema, type DeviationField, type DeviationValues } from './deviationSchema'

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
}) {
  const errorId = `${id}-error`
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined })}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Records (or edits) something eaten outside the plan. `meal`: inside the meal `mealLabel`, asks what and how much.
 * `extra`: a meal outside the plan, also asks the time (default: now). Editing (`initial`) also offers "Apagar desvio".
 */
export function DeviationSheet({
  mode,
  mealLabel,
  initial,
  busy,
  now,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: 'meal' | 'extra'
  mealLabel?: string
  initial?: DietDeviationLocal
  busy: boolean
  /** The clock for the default time (tests). */
  now?: Date
  onSave(values: DeviationValues): void
  onDelete?(): void
  onCancel(): void
}) {
  const baseId = useId()
  const extra = mode === 'extra'
  const [description, setDescription] = useState(initial?.description ?? '')
  const [quantity, setQuantity] = useState(initial?.quantity ?? '')
  const [time, setTime] = useState(() => initial?.time ?? clockOf(now ?? new Date()))
  const [errors, setErrors] = useState<Partial<Record<DeviationField, string>>>({})

  const title = initial ? 'Editar desvio' : extra ? 'Refeição fora do plano' : 'Comi algo fora do plano'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const parsed = deviationSchema(extra).safeParse({ description, quantity, time })
    if (!parsed.success) {
      const next: Partial<Record<DeviationField, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as DeviationField
        next[field] ??= issue.message
      }
      setErrors(next)
      return
    }
    onSave(parsed.data)
  }

  return (
    <Sheet title={title} onCancel={onCancel}>
      {mealLabel && !extra && <p className="-mt-2 text-sm text-muted">{mealLabel}</p>}
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field id={`${baseId}-what`} label="O que foi" error={errors.description}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="off"
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setErrors((x) => ({ ...x, description: undefined }))
              }}
              className={inputClass}
            />
          )}
        </Field>
        <Field id={`${baseId}-qty`} label="Quantidade (opcional)" error={errors.quantity}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="off"
              maxLength={MAX_QUANTITY_LENGTH}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        {extra && (
          <Field id={`${baseId}-time`} label="Horário" error={errors.time}>
            {(props) => (
              <input
                {...props}
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  setErrors((x) => ({ ...x, time: undefined }))
                }}
                className={`${inputClass} tabular-nums`}
              />
            )}
          </Field>
        )}
        <div className={ACTION_ROW}>
          <Button type="submit" variant="primary" aria-disabled={busy || undefined}>
            Salvar
          </Button>
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
        {onDelete && (
          <Button variant="danger" block aria-disabled={busy || undefined} onClick={() => !busy && onDelete()}>
            Apagar desvio
          </Button>
        )}
      </form>
    </Sheet>
  )
}
