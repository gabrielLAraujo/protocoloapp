import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/** An empty screen or section: what is missing and, when there is one, the action that fills it. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  compact = false,
}: {
  icon: IconName
  title?: ReactNode
  /** The explanation (one short sentence). */
  children?: ReactNode
  action?: ReactNode
  /** Inside a card or a section: no frame, smaller. */
  compact?: boolean
}) {
  return (
    <div
      className={
        compact
          ? 'flex items-start gap-3 py-1'
          : 'grid justify-items-start gap-4 rounded-card border border-dashed border-line bg-surface/60 p-6'
      }
    >
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-control bg-raised text-muted ${compact ? 'size-9' : 'size-12'}`}
      >
        <Icon name={icon} size={compact ? 18 : 24} />
      </span>
      <div className="grid gap-1">
        {title && <p className="text-base font-semibold text-ink">{title}</p>}
        {children && <p className={compact ? 'pt-2 text-sm text-muted' : title ? 'text-sm text-muted' : 'text-base text-ink'}>{children}</p>}
      </div>
      {action}
    </div>
  )
}
