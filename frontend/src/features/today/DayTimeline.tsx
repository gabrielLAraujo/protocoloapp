import type { AdherenceStatus } from '../../data/adherenceRepo'
import { cardClasses } from '../../ui/styles'
import { TargetRow } from './TargetRow'
import { groupByPeriod, isLate, PERIOD_LABELS, type TodayRow, type TodayView } from './todayData'

/** The day's targets by period (Manhã, Tarde, Noite, Sem horário), each period a list card in time order. */
export function DayTimeline({
  view,
  now,
  busy,
  onChoose,
  onOpen,
}: {
  view: TodayView
  now: Date
  busy: boolean
  onChoose(row: TodayRow, status: AdherenceStatus): void
  onOpen(row: TodayRow): void
}) {
  return (
    <ul aria-label="Itens de hoje" className="grid gap-5">
      {groupByPeriod(view.rows).map(({ period, rows }) => (
        <li key={period} aria-labelledby={`period-${period}`} className="grid gap-2">
          <h2 id={`period-${period}`} className="px-1 text-sm font-semibold text-muted">
            {PERIOD_LABELS[period]}
          </h2>
          <ul className={cardClasses({ tone: 'list' })}>
            {rows.map((row) => (
              <TargetRow
                key={`${row.target.type}:${row.target.key}`}
                row={row}
                late={isLate(row, view.date, now)}
                busy={busy}
                onChoose={(status) => onChoose(row, status)}
                onOpen={() => onOpen(row)}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
