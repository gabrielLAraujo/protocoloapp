import { MUSCLE_GROUPS, muscleGroupLabel, type MuscleGroup } from '../../domain/muscleGroups'
import type { GroupTrends, Trend } from '../../domain/strength'
import { Card } from '../../ui/Card'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'

const kg = (v: number) => `${Math.round(v)} kg`

function TrendRow({ trend }: { trend: Trend }) {
  const rounded = Math.round(trend.delta)
  const flat = rounded === 0
  const up = trend.delta > 0
  const tone = flat ? 'text-muted' : up ? 'text-ok' : 'text-danger'
  return (
    <ListRow
      title={trend.name}
      subtitle={`${kg(trend.firstE1rm)} → ${kg(trend.lastE1rm)}`}
      value={
        <span className={tone}>
          <span aria-hidden="true">{flat ? '=' : up ? '▲' : '▼'}</span> {flat ? 'igual' : `${up ? '+' : '−'}${Math.abs(rounded)} kg`}
        </span>
      }
    />
  )
}

/** Strength change per muscle group (e1RM between the first and last session of the cycle). */
export function StrengthByGroup({ strength }: { strength: Record<MuscleGroup, GroupTrends> | null }) {
  const groups = strength ? MUSCLE_GROUPS.filter((g) => strength[g].best.length > 0) : []
  return (
    <section aria-labelledby="strength-title" className="grid gap-1">
      <SectionHeader id="strength-title" title="Força por grupo" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted">Sem dados: são precisas ao menos 2 sessões do mesmo exercício no ciclo.</p>
      ) : (
        <div className="grid gap-3">
          {groups.map((g) => (
            <div key={g} className="grid gap-1">
              <h3 className="px-1 text-sm font-semibold text-muted">{muscleGroupLabel(g)}</h3>
              <Card tone="list">
                {strength![g].best.map((t) => (
                  <TrendRow key={t.exerciseId} trend={t} />
                ))}
                {strength![g].worst.map((t) => (
                  <TrendRow key={t.exerciseId} trend={t} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
