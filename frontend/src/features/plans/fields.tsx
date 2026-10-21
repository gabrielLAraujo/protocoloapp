import { useId, useState, type ReactNode } from 'react'
import { useIsLow } from './lowConfidence'
import { inputClass } from './styles'
import { cardClasses, chipClasses } from '../../ui/styles'

export function ConfiraBadge() {
  return <span className={chipClasses({ tone: 'warn' })}>Confira</span>
}

export function Field({
  label,
  path,
  children,
  invalid,
  error,
}: {
  label: string
  path?: string
  invalid?: boolean
  /** Shown under the input (and marks it invalid). */
  error?: string
  children: (props: { id: string; className: string; 'aria-invalid'?: true }) => ReactNode
}) {
  const id = useId()
  const low = useIsLow(path ?? '\u0000')
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-6 items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-muted">
          {label}
        </label>
        {low && <ConfiraBadge />}
      </div>
      {children({
        id,
        className: `${inputClass}${low ? ' border-warn bg-warn/10' : ''}${invalid || error ? ' border-danger' : ''}`,
        ...((invalid || error) && { 'aria-invalid': true as const }),
      })}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

export function TextField({
  label,
  path,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
}: {
  label: string
  path?: string
  value: string | null | undefined
  onChange: (value: string | undefined) => void
  type?: 'text' | 'date'
  placeholder?: string
  error?: string
}) {
  return (
    <Field label={label} path={path} error={error}>
      {(props) => (
        <input
          {...props}
          type={type}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )}
    </Field>
  )
}

const parse = (text: string): number | undefined => {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() === '' || Number.isNaN(n) ? undefined : n
}

/** A number box that lets the user type freely ("12,") and reports the parsed value (undefined when empty). */
export function NumberField({
  label,
  path,
  value,
  onChange,
  decimal,
  error,
}: {
  label: string
  path?: string
  value: number | null | undefined
  onChange: (value: number | undefined) => void
  decimal?: boolean
  error?: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    // The document changed: re-show it, unless this very typing produced it (then keep what the user typed, e.g. "12,").
    setSeen(value)
    if (parse(text) !== (value ?? undefined)) setText(value == null ? '' : String(value))
  }
  return (
    <Field label={label} path={path} error={error}>
      {(props) => (
        <input
          {...props}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={text}
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            const parsed = parse(next)
            onChange(parsed === undefined ? undefined : decimal ? parsed : Math.trunc(parsed))
          }}
        />
      )}
    </Field>
  )
}

export function SelectField({
  label,
  path,
  value,
  onChange,
  options,
  invalid,
  disabled,
  error,
}: {
  label: string
  path?: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  invalid?: boolean
  disabled?: boolean
  error?: string
}) {
  return (
    <Field label={label} path={path} invalid={invalid} error={error}>
      {(props) => (
        <select {...props} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function Section({ title, children, path }: { title: string; children: ReactNode; path?: string }) {
  const low = useIsLow(path ?? '\u0000')
  return (
    <section aria-label={title} className={cardClasses({ className: `grid gap-4${low ? ' border-warn!' : ''}` })}>
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        {low && <ConfiraBadge />}
      </div>
      {children}
    </section>
  )
}
