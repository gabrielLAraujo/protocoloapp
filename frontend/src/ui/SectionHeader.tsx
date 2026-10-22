import type { ReactNode } from 'react'

/** A section title (17/24 semibold) with an optional action on the right, e.g. a "Ver conquistas" link. */
export function SectionHeader({
  title,
  action,
  as: Tag = 'h2',
  id,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
  /** For `aria-labelledby` on the section it heads. */
  id?: string
  className?: string
}) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-3${className ? ` ${className}` : ''}`}>
      <Tag id={id} className="text-lg font-semibold text-ink">
        {title}
      </Tag>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </div>
  )
}
