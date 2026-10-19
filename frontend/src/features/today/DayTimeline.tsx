import type { AdherenceStatus } from '../../data/adherenceRepo'
import { TargetRow } from './TargetRow'
import { isLate, type TodayRow, type TodayView } from './todayData'

/** The day's targets in time order (untimed last), as buildDay sorts them. */
export function DayTimeline({
  view,
  now,
  busy,
  onChoose,
}: {
  view: TodayView
  now: Date
  busy: boolean
  onChoose(row: TodayRow, status: AdherenceStatus): void
}) {
  return (
    <ul aria-label="Itens de hoje" className="grid gap-2">
      {view.rows.map((row) => (
        <TargetRow
          key={`${row.target.type}:${row.target.key}`}
          row={row}
          late={isLate(row, view.date, now)}
          busy={busy}
          onChoose={(status) => onChoose(row, status)}
        />
      ))}
    </ul>
  )
}
