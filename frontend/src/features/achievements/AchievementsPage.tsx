import { useEffect, useState, type ReactNode } from 'react'
import { useData } from '../../data/dataContext'
import type { Medal, MedalKey } from '../../domain/progress'
import { Card } from '../../ui/Card'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { SectionHeader } from '../../ui/SectionHeader'
import { cardClasses } from '../../ui/styles'
import { localDate } from '../checkin/localDate'
import { loadProgress, type ProgressData } from '../progress/progressData'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { MedalArt } from './MedalArt'

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

/** "12/10/2026" for yyyy-MM-dd. */
const shortDate = (date: string) => {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

const days = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

function EarnedMedal({ medal }: { medal: Medal }) {
  return (
    <li aria-label={medal.label} className="flex items-center gap-3 px-4 py-3">
      <MedalArt medal={medal.key} earned size={48} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-base font-semibold text-ink">{medal.label}</p>
        <p className="text-sm text-muted tabular-nums">
          {medal.count > 1 ? `Última em ${shortDate(medal.earnedOn!)}` : `Conquistada em ${shortDate(medal.earnedOn!)}`}
        </p>
      </div>
      {medal.count > 1 && (
        <span aria-label={`${medal.count} vezes`} className="shrink-0 tabular-nums">
          <Chip tone="accent">{medal.count}×</Chip>
        </span>
      )}
    </li>
  )
}

/** What a medal's progress counts: goals of this week, workouts of the cycle, days in a row. */
const PROGRESS_UNIT: Record<MedalKey, string> = {
  perfect_week: 'metas',
  all_workouts_cycle: 'treinos',
  diet_100_7: 'dias',
  streak_7: 'dias',
  streak_14: 'dias',
  streak_30: 'dias',
}

function LockedMedal({ medal }: { medal: Medal }) {
  const { value, target } = medal.progress
  const fill = target > 0 ? Math.min(1, value / target) : 0
  return (
    <li aria-label={medal.label} className="flex items-center gap-3 px-4 py-3">
      <MedalArt medal={medal.key} earned={false} size={48} />
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-base font-semibold text-ink">{medal.label}</p>
          <span className="shrink-0 text-sm text-muted tabular-nums">{target > 0 ? `${value} de ${target} ${PROGRESS_UNIT[medal.key]}` : '—'}</span>
        </div>
        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line">
          <div data-bar-fill className="h-full rounded-full bg-accent" style={{ width: `${Math.round(fill * 1000) / 10}%` }} />
        </div>
      </div>
    </li>
  )
}

/** `/conquistas`: the streak, the medals already earned (when, how many times) and the ones still locked (progress). */
export function AchievementsPage() {
  const data = useData()
  const { dataVersion } = useSync()
  const today = useToday()
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    const at = new Date()
    loadProgress(data.db, localDate(at), at).then(
      (result) => {
        if (!cancelled) {
          setProgress(result)
          setFailed(false)
        }
      },
      (e: unknown) => {
        console.error('could not compute the progress', e)
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion])

  if (failed) return <Message>Não foi possível calcular as conquistas.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (!progress) return <Message>Carregando…</Message>

  const earned = progress.medals.filter((m) => m.count > 0)
  const locked = progress.medals.filter((m) => m.count === 0)
  const { current, best } = progress.streak

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-bold">Conquistas</h1>
        <p className="text-sm text-muted tabular-nums">
          {earned.length} de {progress.medals.length} medalhas
        </p>
      </header>

      <Card as="section" aria-label="Sequência" tone={current > 0 ? 'accent' : 'default'} className="flex items-center gap-4">
        <span className={`grid size-12 shrink-0 place-items-center rounded-control ${current > 0 ? 'bg-surface text-accent' : 'bg-raised text-muted'}`}>
          <Icon name="streak" size={26} />
        </span>
        <div className="grid flex-1 gap-0.5">
          <p className="text-lg font-semibold text-ink tabular-nums">{days(current)} na meta</p>
          <p className="text-sm text-muted">
            Recorde: {days(best)}. Um dia conta quando chega a 90% do previsto.
          </p>
        </div>
      </Card>

      {earned.length > 0 && (
        <section aria-labelledby="earned-title" className="grid gap-1">
          <SectionHeader id="earned-title" title="Conquistadas" />
          <ul className={cardClasses({ tone: 'list' })}>
            {earned.map((m) => (
              <EarnedMedal key={m.key} medal={m} />
            ))}
          </ul>
        </section>
      )}

      {locked.length > 0 && (
        <section aria-labelledby="locked-title" className="grid gap-1">
          <SectionHeader id="locked-title" title="A conquistar" />
          <ul className={cardClasses({ tone: 'list' })}>
            {locked.map((m) => (
              <LockedMedal key={m.key} medal={m} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
