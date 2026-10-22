import { Card } from '../../ui/Card'
import type { RestockItem } from './todayData'

const dayMonth = (date: string) => {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

/**
 * "A repor" on Hoje: the protocol items marked "Acabou" in the last 14 days and not done since. Nothing to restock,
 * no card; an item leaves the list by itself once it is marked "Feito" again.
 */
export function RestockCard({ items }: { items: readonly RestockItem[] }) {
  if (items.length === 0) return null
  return (
    <Card as="section" aria-labelledby="restock-title" className="grid gap-3">
      <h2 id="restock-title" className="text-base font-semibold">
        A repor
      </h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</span>
            <span className="shrink-0 text-muted tabular-nums">acabou em {dayMonth(item.date)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
