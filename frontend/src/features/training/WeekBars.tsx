import { formatShortDate } from '../workout/format'
import type { WeekBar } from './trainingStats'

/**
 * Workouts done and planned per week: one row per week with a block per workout (filled = done, outlined = planned and
 * not done) and "2/3" on the right. Each row also says it in words for screen readers ("Semana de 12/10: 2 de 3").
 */
export function WeekBars({ weeks }: { weeks: WeekBar[] }) {
  if (weeks.every((w) => w.done === 0 && w.planned === 0)) return <p className="text-sm text-muted">Nenhum treino previsto ou feito no período.</p>

  return (
    <div className="grid gap-3">
      <ul aria-label="Treinos por semana" className="grid gap-2">
        {weeks.map((w) => {
          const blocks = Math.max(w.done, w.planned)
          return (
            <li key={w.weekStart} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3">
              <span className="sr-only">{`Semana de ${formatShortDate(w.weekStart)}: ${w.done} de ${w.planned}`}</span>
              <span aria-hidden="true" className="text-xs text-muted tabular-nums">
                {formatShortDate(w.weekStart)}
              </span>
              <span aria-hidden="true" className="flex gap-1">
                {Array.from({ length: blocks }, (_, i) => (
                  <span key={i} className={`h-3 max-w-6 flex-1 rounded-sm ${i < w.done ? 'bg-ink' : 'border border-line bg-raised'}`} />
                ))}
              </span>
              <span aria-hidden="true" className="text-sm font-medium text-ink tabular-nums">
                {w.done}/{w.planned}
              </span>
            </li>
          )
        })}
      </ul>
      <ul aria-label="Legenda" className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm bg-ink" /> Feito
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm border border-line bg-raised" /> Previsto, não feito
        </li>
      </ul>
    </div>
  )
}
