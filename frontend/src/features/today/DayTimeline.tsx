import type { AdherenceStatus } from '../../data/adherenceRepo'
import type { DietDeviationLocal } from '../../data/dietDeviationRepo'
import { cardClasses, GROUP_LABEL } from '../../ui/styles'
import { ExtraMealRow } from './ExtraMealRow'
import { TargetRow } from './TargetRow'
import { isLate, PERIOD_LABELS, timelineGroups, type TodayRow, type TodayView } from './todayData'

/**
 * The day's targets by period (Manhã, Tarde, Noite, Sem horário), each period a list card in time order. Meals outside
 * the plan are rows of the period of their time.
 */
export function DayTimeline({
  view,
  now,
  busy,
  past = false,
  onChoose,
  onOpen,
  onOpenExtra,
}: {
  view: TodayView
  now: Date
  busy: boolean
  /** A day before today: the check-in and workout links open that date. */
  past?: boolean
  onChoose(row: TodayRow, status: AdherenceStatus): void
  onOpen(row: TodayRow): void
  onOpenExtra(deviation: DietDeviationLocal): void
}) {
  return (
    <ul aria-label="Itens de hoje" className="grid gap-5">
      {timelineGroups(view.rows, view.extras).map(({ period, items }) => (
        <li key={period} aria-labelledby={`period-${period}`} className="grid gap-2">
          <h2 id={`period-${period}`} className={GROUP_LABEL}>
            {PERIOD_LABELS[period]}
          </h2>
          <ul className={cardClasses({ tone: 'list' })}>
            {items.map((item) =>
              item.kind === 'target' ? (
                <TargetRow
                  key={`${item.row.target.type}:${item.row.target.key}`}
                  row={item.row}
                  late={isLate(item.row, view.date, now)}
                  busy={busy}
                  day={past ? view.date : undefined}
                  onChoose={(status) => onChoose(item.row, status)}
                  onOpen={() => onOpen(item.row)}
                />
              ) : (
                <ExtraMealRow key={`deviation:${item.deviation.id}`} deviation={item.deviation} busy={busy} onOpen={() => onOpenExtra(item.deviation)} />
              ),
            )}
          </ul>
        </li>
      ))}
    </ul>
  )
}
