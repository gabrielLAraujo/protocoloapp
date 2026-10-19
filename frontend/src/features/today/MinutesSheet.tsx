import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { inputClass } from '../plans/styles'

const MAX_CARDIO_MINUTES = 300

/** "40" → 40; "" → null; anything else (or out of 0–300) → undefined (invalid). */
function parseMinutes(text: string): number | null | undefined {
  const value = text.trim()
  if (value === '') return null
  if (!/^\d{1,3}$/.test(value)) return undefined
  const minutes = Number(value)
  return minutes <= MAX_CARDIO_MINUTES ? minutes : undefined
}

/**
 * "Quantos minutos?" after marking cardio done. The minutes are optional: "Salvar" with the field empty or "Pular"
 * marks it done without them. Escape (or a tap outside) cancels: nothing is marked.
 */
export function MinutesSheet({
  busy,
  onSave,
  onSkip,
  onCancel,
}: {
  busy: boolean
  onSave(minutes: number | null): void
  onSkip(): void
  onCancel(): void
}) {
  const inputId = useId()
  const errorId = useId()
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const minutes = parseMinutes(text)
    if (minutes === undefined) {
      setInvalid(true)
      return
    }
    onSave(minutes)
  }

  return (
    <Sheet title="Quantos minutos?" onCancel={onCancel}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            Minutos de cardio (opcional)
          </label>
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(e) => {
              setText(e.target.value)
              setInvalid(false)
            }}
            className={inputClass}
          />
          {invalid && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              Informe um número inteiro de 0 a {MAX_CARDIO_MINUTES}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" aria-disabled={busy || undefined}>
            Salvar
          </Button>
          <Button className="flex-1" aria-disabled={busy || undefined} onClick={() => !busy && onSkip()}>
            Pular
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
