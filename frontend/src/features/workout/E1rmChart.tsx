import { useId } from 'react'
import { formatKg, formatShortDate } from './format'

export interface E1rmPoint {
  /** yyyy-MM-dd */
  date: string
  /** Estimated 1RM in kg. */
  value: number
}

const W = 320
const H = 160
const PAD = { left: 44, right: 12, top: 12, bottom: 26 }

/**
 * The e1RM of each session as a small line chart (no chart library). Points are evenly spaced, oldest on the left.
 * A visually hidden table carries the same data for screen readers.
 */
export function E1rmChart({ points }: { points: E1rmPoint[] }) {
  const titleId = useId()
  const descId = useId()
  if (points.length === 0) return <p className="text-sm text-muted">Ainda não há séries para o gráfico.</p>

  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min -= 1
    max += 1
  }
  const x = (i: number) => (points.length === 1 ? (PAD.left + W - PAD.right) / 2 : PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1))
  const y = (v: number) => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / (max - min)
  const first = points[0]!
  const last = points[points.length - 1]!
  const description =
    points.length === 1
      ? `Uma sessão: ${formatKg(first.value)} kg em ${formatShortDate(first.date)}.`
      : `De ${formatKg(first.value)} kg em ${formatShortDate(first.date)} para ${formatKg(last.value)} kg em ${formatShortDate(last.date)}, em ${points.length} sessões.`

  return (
    <figure className="grid gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} aria-describedby={descId} className="h-auto w-full">
        <title id={titleId}>1RM estimado por sessão</title>
        <desc id={descId}>{description}</desc>
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-line" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="stroke-line" />
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="fill-muted text-xs tabular-nums">
          {formatKg(Math.round(max * 10) / 10)}
        </text>
        <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" className="fill-muted text-xs tabular-nums">
          {formatKg(Math.round(min * 10) / 10)}
        </text>
        <text x={PAD.left} y={H - 6} textAnchor="start" className="fill-muted text-xs tabular-nums">
          {formatShortDate(first.date)}
        </text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted text-xs tabular-nums">
            {formatShortDate(last.date)}
          </text>
        )}
        {points.length > 1 && (
          <polyline fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-accent" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
        )}
        {points.map((p, i) => (
          <circle key={`${p.date}:${i}`} cx={x(i)} cy={y(p.value)} r={3.5} className="fill-accent" />
        ))}
      </svg>
      <figcaption className="text-xs text-muted">1RM estimado (kg) por sessão</figcaption>
      <table className="sr-only">
        <caption>1RM estimado por sessão</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">1RM estimado (kg)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.date}:${i}`}>
              <td>{formatShortDate(p.date)}</td>
              <td>{formatKg(Math.round(p.value * 10) / 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
