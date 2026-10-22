import type { WeekGoal } from '../../domain/progress'
import { Card } from '../../ui/Card'
import { Icon } from '../../ui/Icon'

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** How full the bar is: percent goals over 0–100 (the target is a tick), count goals over their target (clamped). */
const fillOf = (g: WeekGoal) => clamp01(g.unit === 'percent' ? g.progress / 100 : g.target > 0 ? g.progress / g.target : 0)

const valueOf = (g: WeekGoal) => (g.unit === 'percent' ? `${g.progress}%` : `${g.progress} de ${g.target}`)

/** A goal's line: label and value, then the bar (with the 90 % mark on percent goals). */
function GoalRow({ goal }: { goal: WeekGoal }) {
  const fill = fillOf(goal)
  return (
    <li aria-label={goal.label} className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{goal.label}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 tabular-nums ${goal.done ? 'font-semibold text-ink' : 'text-muted'}`}>
          {goal.done && <Icon name="check" size={14} strokeWidth={2.6} label="Meta batida" />}
          {valueOf(goal)}
        </span>
      </div>
      <div aria-hidden="true" className="relative h-1.5 rounded-full bg-line">
        <div
          data-bar-fill
          className={`h-full w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none ${goal.done ? 'bg-ink' : 'bg-ink/55'}`}
          style={{ transform: `scaleX(${Math.round(fill * 1000) / 1000})` }}
        />
        {goal.unit === 'percent' && (
          <span className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-ink/60" style={{ left: `${goal.target}%` }} />
        )}
      </div>
    </li>
  )
}

/** "Semana" on Hoje: the Monday–Sunday goals with their progress. */
export function WeekCard({ goals }: { goals: readonly WeekGoal[] }) {
  if (goals.length === 0) return null
  const done = goals.filter((g) => g.done).length
  return (
    <Card as="section" aria-labelledby="week-title" className="grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-title" className="text-base font-semibold">
          Semana
        </h2>
        <span className="text-sm text-muted tabular-nums">
          {done} de {goals.length} {goals.length === 1 ? 'meta' : 'metas'}
        </span>
      </div>
      <ul className="grid gap-4">
        {goals.map((g) => (
          <GoalRow key={g.key} goal={g} />
        ))}
      </ul>
    </Card>
  )
}
