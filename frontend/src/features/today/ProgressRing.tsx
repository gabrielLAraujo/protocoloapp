import type { ReactNode } from 'react'
import type { DayScore } from '../../domain/progress'

const SIZE = 88
const STROKE = 8
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

/** Whole percent, rounded down: the ring reads 100 % only when the day is really complete. */
const percentOf = (score: DayScore): number | null => (score.ratio === null ? null : Math.floor(score.ratio * 100 + 1e-9))

const partialText = (n: number) => (n === 0 ? '' : ` · ${n} ${n === 1 ? 'parcial' : 'parciais'}`)

/**
 * The day's ring: the share of the whole day done (partial counts half). The arc grows with a transition (none with
 * reduced motion). `children` sits on top of it (the celebration).
 */
export function ProgressRing({ score, children }: { score: DayScore; children?: ReactNode }) {
  const percent = percentOf(score)
  const fraction = percent === null ? 0 : percent / 100
  return (
    <div
      role="progressbar"
      aria-label="Progresso do dia"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? 0}
      aria-valuetext={percent === null ? 'Nada previsto' : `${percent}% — ${score.done} de ${score.planned}${partialText(score.partial)}`}
      className="relative grid shrink-0 place-items-center"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true" className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
        {fraction > 0 && (
          <circle
            data-ring-arc
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-content-center text-center">
        <span className="text-lg leading-none font-bold tracking-tight tabular-nums">
          {percent === null ? '—' : percent}
          {percent !== null && <span className="text-sm font-semibold text-muted">%</span>}
        </span>
      </span>
      {children}
    </div>
  )
}
