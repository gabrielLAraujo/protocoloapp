import type { WeightPoint } from './summaryData'

const W = 280
const H = 56
const PAD = 4

const formatKg = (v: number) => v.toFixed(1).replace('.', ',')

/** Weight over the cycle as a small inline SVG (no chart library). With fewer than two weigh-ins it is a sentence, not a chart. */
export function WeightSparkline({ points }: { points: WeightPoint[] }) {
  if (points.length === 0) return <p className="text-sm text-muted">Sem pesagens no ciclo.</p>
  if (points.length === 1)
    return <p className="text-sm text-muted">Uma pesagem no ciclo ({formatKg(points[0].kg)} kg). O gráfico aparece a partir da segunda.</p>
  const first = points[0].kg
  const last = points[points.length - 1].kg
  const delta = Math.round((last - first) * 10) / 10
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  const summary = `Peso: ${formatKg(first)} kg → ${formatKg(last)} kg (${sign}${formatKg(Math.abs(delta))} kg)`

  const kgs = points.map((p) => p.kg)
  const min = Math.min(...kgs)
  const max = Math.max(...kgs)
  const span = max - min || 1
  const x = (i: number) => (PAD + (i * (W - 2 * PAD)) / (points.length - 1))
  const y = (kg: number) => PAD + ((max - kg) * (H - 2 * PAD)) / span
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(' ')

  return (
    <figure className="grid gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-16 w-full overflow-visible">
        <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />
        <circle cx={x(points.length - 1)} cy={y(last)} r={3.5} className="fill-accent" />
      </svg>
      <figcaption className="text-sm tabular-nums text-muted">{summary}</figcaption>
    </figure>
  )
}
