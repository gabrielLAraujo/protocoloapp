import { weekdayOf } from '../../domain/calendarDate'
import { formatShortDate } from '../workout/format'
import type { CalendarDay, DayState } from './summaryData'

const HEADERS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const WEEKDAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const

const SYMBOL: Record<DayState, string> = { done: '✓', missed: '✗', rest: '–', future: '', today: '' }
const LABEL: Record<DayState, string> = {
  done: 'treino feito',
  missed: 'treino não feito',
  rest: 'descanso',
  future: 'ainda não chegou',
  today: 'hoje',
}
const STYLE: Record<DayState, string> = {
  done: 'border-ok text-ok',
  missed: 'border-danger text-danger',
  rest: 'border-line text-muted',
  future: 'border-line border-dashed text-muted',
  today: 'border-accent border-2 text-ink',
}

function describe(day: CalendarDay): string {
  const parts = [formatShortDate(day.date)]
  if (day.state === 'today') parts.push(day.done ? 'hoje, treino feito' : day.planned ? 'hoje, treino previsto' : 'hoje')
  else parts.push(LABEL[day.state] + (day.state === 'future' && day.planned ? ', treino previsto' : ''))
  if (day.cardio) parts.push('cardio feito')
  return parts.join(', ')
}

/** Weekly grid (Mon-Sun) of the cycle. State is shown by symbol and border, never by color alone. */
export function CycleCalendar({ days }: { days: CalendarDay[] }) {
  if (days.length === 0) return null
  const lead = WEEKDAY_INDEX[weekdayOf(days[0].date)]
  const cells: (CalendarDay | null)[] = [...Array<null>(lead).fill(null), ...days]
  const rows: (CalendarDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <section aria-labelledby="calendar-title" className="grid gap-2">
      <h2 id="calendar-title" className="text-base font-semibold">Calendário do ciclo</h2>
      <div role="table" aria-label="Calendário do ciclo" className="grid gap-1">
        <div role="row" className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
          {HEADERS.map((h) => (
            <span key={h} role="columnheader">{h}</span>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} role="row" className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }, (_, c) => {
              const day = row[c] ?? null
              if (!day) return <span key={c} role="cell" aria-hidden="true" />
              return (
                <span
                  key={c}
                  role="cell"
                  aria-label={describe(day)}
                  aria-current={day.state === 'today' ? 'date' : undefined}
                  data-state={day.state}
                  className={`relative flex min-h-11 flex-col items-center justify-center rounded-control border bg-surface text-xs ${STYLE[day.state]}`}
                >
                  <span className="tabular-nums">{day.date.slice(8)}</span>
                  <span aria-hidden="true" className="text-sm font-bold leading-none">
                    {day.state === 'today' ? (day.done ? '✓' : day.planned ? '•' : '') : SYMBOL[day.state]}
                  </span>
                  {day.cardio && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li><span aria-hidden="true" className="font-bold text-ok">✓</span> Treino feito</li>
        <li><span aria-hidden="true" className="font-bold text-danger">✗</span> Treino não feito</li>
        <li><span aria-hidden="true" className="font-bold">–</span> Descanso</li>
        <li><span aria-hidden="true" className="font-bold">•</span> Hoje, treino previsto</li>
        <li><span aria-hidden="true" className="inline-block size-2 rounded-full bg-accent" /> Cardio feito</li>
      </ul>
    </section>
  )
}
