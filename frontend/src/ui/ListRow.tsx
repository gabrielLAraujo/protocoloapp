import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from './Icon'

const ROW =
  'flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
const INTERACTIVE = 'hover:bg-raised active:bg-raised'

/**
 * One row of a list card (`<Card tone="list">`): optional leading mark (a position number, never a decorative icon), title, subtitle, and a value on the right in tabular
 * numbers. With `to` it is a link (with a chevron), with `onClick` a button, otherwise a plain row. `trailing` goes after
 * the value (a chip, a button of its own when the row is not interactive); `children` go under the subtitle.
 *
 * With `term` it is one group of a description list (inside a `<dl>`, e.g. `<Card as="dl" tone="list">`): the title is
 * the `<dt>`, the value the first `<dd>` and the subtitle a second one, laid out like the plain row. Only title, subtitle
 * and value are drawn then.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  value,
  to,
  onClick,
  trailing,
  children,
  className,
  term,
}: {
  /** Something that carries meaning before the title (e.g. the exercise's position), drawn muted. */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  value?: ReactNode
  to?: string
  onClick?: () => void
  trailing?: ReactNode
  children?: ReactNode
  className?: string
  /** A label → value pair of a `<dl>` (see above). */
  term?: boolean
}) {
  if (term)
    return (
      <div className={`grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5${className ? ` ${className}` : ''}`}>
        <dt className="col-start-1 row-start-1 text-base font-medium text-ink [overflow-wrap:anywhere]">{title}</dt>
        {value !== undefined && value !== null && (
          <dd className="col-start-2 row-span-2 row-start-1 text-right text-base font-medium text-ink tabular-nums">{value}</dd>
        )}
        {subtitle && <dd className="col-start-1 row-start-2 text-sm text-muted">{subtitle}</dd>}
      </div>
    )
  const body = (
    <>
      {leading !== undefined && leading !== null && (
        <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted tabular-nums">{leading}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink [overflow-wrap:anywhere]">{title}</span>
        {subtitle && <span className="block text-sm text-muted">{subtitle}</span>}
        {children}
      </span>
      {value !== undefined && value !== null && (
        <span className="shrink-0 text-right text-base font-medium text-ink tabular-nums">{value}</span>
      )}
      {trailing}
      {to && <Icon name="chevronRight" size={18} className="text-muted" />}
    </>
  )
  const classes = `${ROW}${to || onClick ? ` ${INTERACTIVE}` : ''}${className ? ` ${className}` : ''}`
  if (to)
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    )
  return <div className={classes}>{body}</div>
}
