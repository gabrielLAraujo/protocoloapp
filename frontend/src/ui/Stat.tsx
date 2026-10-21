import type { ReactNode } from 'react'

/**
 * A highlighted number: label (13/18 semibold, muted), value (32/36 semibold, tabular) and an optional caption. It is one
 * term of a description list, so place it inside a `<dl>` (e.g. `<Card as="dl">`): the label is the `<dt>`, the value the
 * first `<dd>` and the caption a second one.
 */
export function Stat({ label, value, caption, className }: { label: ReactNode; value: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={`grid min-w-0 content-start gap-1${className ? ` ${className}` : ''}`}>
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-display font-semibold text-ink tabular-nums [overflow-wrap:anywhere]">{value}</dd>
      {caption && <dd className="text-xs text-muted">{caption}</dd>}
    </div>
  )
}
