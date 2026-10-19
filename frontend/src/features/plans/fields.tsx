import { useId, useState, type ReactNode } from 'react'
import { useIsLow } from './lowConfidence'
import { inputClass } from './styles'

export function ConfiraBadge() {
  return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">Confira</span>
}

export function Field({
  label,
  path,
  children,
  invalid,
}: {
  label: string
  path?: string
  invalid?: boolean
  children: (props: { id: string; className: string; 'aria-invalid'?: true }) => ReactNode
}) {
  const id = useId()
  const low = useIsLow(path ?? '\u0000')
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {low && <ConfiraBadge />}
      </div>
      {children({
        id,
        className: `${inputClass}${low ? ' border-warn bg-warn/10' : ''}${invalid ? ' border-danger' : ''}`,
        ...(invalid && { 'aria-invalid': true as const }),
      })}
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
}: {
  label: string
  path?: string
  value: string | null | undefined
  onChange: (value: string | undefined) => void
  type?: 'text' | 'date'
  placeholder?: string
}) {
  return (
    <Field label={label} path={path}>
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
}: {
  label: string
  path?: string
  value: number | null | undefined
  onChange: (value: number | undefined) => void
  decimal?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    // The document changed: re-show it, unless this very typing produced it (then keep what the user typed, e.g. "12,").
    setSeen(value)
    if (parse(text) !== (value ?? undefined)) setText(value == null ? '' : String(value))
  }
  return (
    <Field label={label} path={path}>
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
}: {
  label: string
  path?: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  invalid?: boolean
}) {
  return (
    <Field label={label} path={path} invalid={invalid}>
      {(props) => (
        <select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
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
    <section aria-label={title} className={`grid gap-3 rounded-control border p-3 ${low ? 'border-warn' : 'border-line'} bg-surface`}>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        {low && <ConfiraBadge />}
      </div>
      {children}
    </section>
  )
}
