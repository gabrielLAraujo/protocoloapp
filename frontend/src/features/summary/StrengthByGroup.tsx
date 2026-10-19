import { MUSCLE_GROUPS, muscleGroupLabel, type MuscleGroup } from '../../domain/muscleGroups'
import type { GroupTrends, Trend } from '../../domain/strength'

const kg = (v: number) => `${Math.round(v)} kg`

function TrendLine({ trend }: { trend: Trend }) {
  const rounded = Math.round(trend.delta)
  const flat = rounded === 0
  const up = trend.delta > 0
  const tone = flat ? 'text-muted' : up ? 'text-ok' : 'text-danger'
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="min-w-0 truncate">{trend.name}</span>
      <span className={`shrink-0 tabular-nums ${tone}`}>
        <span aria-hidden="true">{flat ? '=' : up ? '▲' : '▼'}</span> {flat ? 'igual' : `${up ? '+' : '−'}${Math.abs(rounded)} kg`}{' '}
        <span className="text-muted">({kg(trend.firstE1rm)} → {kg(trend.lastE1rm)})</span>
      </span>
    </li>
  )
}

/** Strength change per muscle group (e1RM between the first and last session of the cycle). */
export function StrengthByGroup({ strength }: { strength: Record<MuscleGroup, GroupTrends> | null }) {
  const groups = strength ? MUSCLE_GROUPS.filter((g) => strength[g].best.length > 0) : []
  return (
    <section aria-labelledby="strength-title" className="grid gap-2">
      <h2 id="strength-title" className="text-base font-semibold">Força por grupo</h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">Sem dados: são precisas ao menos 2 sessões do mesmo exercício no ciclo.</p>
      ) : (
        <ul className="grid gap-2">
          {groups.map((g) => (
            <li key={g} className="rounded-control border border-line bg-surface p-3">
              <h3 className="text-sm font-semibold">{muscleGroupLabel(g)}</h3>
              <ul className="mt-1 grid gap-0.5">
                {strength![g].best.map((t) => (
                  <TrendLine key={t.exerciseId} trend={t} />
                ))}
                {strength![g].worst.map((t) => (
                  <TrendLine key={t.exerciseId} trend={t} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
