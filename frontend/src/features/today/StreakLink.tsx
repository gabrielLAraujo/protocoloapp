import { Link } from 'react-router'
import { Icon } from '../../ui/Icon'

/** The current streak (days in a row on target) next to the day's title; opens /conquistas. */
export function StreakLink({ current }: { current: number }) {
  const alight = current > 0
  return (
    <Link
      to="/conquistas"
      aria-label={`Sequência: ${current} ${current === 1 ? 'dia' : 'dias'} na meta — ver conquistas`}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-base font-bold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        alight ? 'border-ink/20 bg-surface text-ink' : 'border-line bg-surface text-muted'
      }`}
    >
      <Icon name="streak" size={20} />
      {current}
    </Link>
  )
}
