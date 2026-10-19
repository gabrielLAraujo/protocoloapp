import { Link } from 'react-router'
import type { CycleInfo } from '../../domain/cycle'
import { countdownText } from './cycleText'
import { formatDate, formatShortDate } from '../workout/format'

/** Start -> update date bar with a "Hoje" marker, the countdown and the billing date. */
export function CycleTimeline({ cycle, setDateLink }: { cycle: CycleInfo; setDateLink: string }) {
  const countdown = countdownText(cycle)
  const overdue = cycle.overdueDays > 0
  const pct = Math.round((cycle.elapsedRatio ?? 0) * 100)
  return (
    <section aria-labelledby="cycle-title" className="grid gap-3 rounded-control border border-line bg-surface p-4">
      <h2 id="cycle-title" className="text-base font-semibold">Ciclo</h2>
      {cycle.end === null ? (
        <p className="text-sm">
          <span className="font-medium">Defina a data da próxima atualização</span>
          <span className="text-muted"> — o protocolo não traz essa data. </span>
          <Link to={setDateLink} className="font-semibold text-accent underline">
            Abrir a revisão
          </Link>
        </p>
      ) : (
        <>
          <div className="pt-6">
            <div
              role="progressbar"
              aria-label="Andamento do ciclo"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`${pct}% do ciclo`}
              className="relative h-2 rounded-full bg-line"
            >
              <div className={`h-full rounded-full ${overdue ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
              <span className="absolute -top-6 -translate-x-1/2 text-xs font-semibold" style={{ left: `${pct}%` }}>
                Hoje
              </span>
              <span
                aria-hidden="true"
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
                style={{ left: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>Início {formatShortDate(cycle.start)}</span>
              <span>Atualização {formatShortDate(cycle.end)}</span>
            </div>
          </div>
          <p className={`text-lg font-semibold ${overdue ? 'text-danger' : ''}`}>
            {overdue && <span aria-hidden="true">! </span>}
            {countdown}
          </p>
        </>
      )}
      {cycle.billingDate && (
        <p className="text-sm text-muted">
          Mensalidade em <time dateTime={cycle.billingDate} title={formatDate(cycle.billingDate)}>{formatShortDate(cycle.billingDate)}</time>
        </p>
      )}
    </section>
  )
}
