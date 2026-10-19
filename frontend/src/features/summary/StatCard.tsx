import type { ReactNode } from 'react'
import { cardClasses } from '../../ui/styles'

/** A labelled figure on the summary. */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className={cardClasses({ padding: 'sm', className: 'grid content-start gap-1' })}>
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums tracking-tight">{value}</dd>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}
