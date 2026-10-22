import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { DayScore } from '../../domain/progress'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { ProgressRing } from './ProgressRing'
import { linkOf, TYPE_ICON } from './targetKinds'
import type { TodayRow } from './todayData'

/** How long "Feito" on the next task stays off after a tap. */
export const DONE_COOLDOWN_MS = 600

/** Where the day stands against its 90 % goal ("Dia completo" is also the static form of the celebration). */
function DayGoalLine({ complete, onTarget }: { complete: boolean; onTarget: boolean }) {
  if (complete)
    return (
      <p className="flex items-center gap-1 text-sm font-semibold text-ok">
        <Icon name="check" size={16} strokeWidth={2.4} />
        Dia completo
      </p>
    )
  if (onTarget) return <p className="text-sm font-medium text-ok">Meta do dia batida</p>
  return <p className="text-sm text-muted">Meta do dia: 90%</p>
}

/** The next task: its type, name and time, and the one action that finishes it ("Feito", or opening its screen). */
function NextTask({ row, late, busy, onDone }: { row: TodayRow; late: boolean; busy: boolean; onDone(): void }) {
  const link = linkOf(row.target)
  return (
    <section aria-labelledby="next-title" className="grid gap-2 border-t border-line pt-4">
      <h2 id="next-title" className="text-sm font-medium text-muted">
        Próxima tarefa
      </h2>
      {/* Keyed by the target: the next task is a new button, not the old one relabelled. */}
      <div key={`${row.target.type}:${row.target.key}`} className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
          <Icon name={TYPE_ICON[row.target.type]} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-snug font-semibold [overflow-wrap:anywhere]">{row.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="tabular-nums">{row.target.time ?? 'Sem horário'}</span>
            {late && (
              <Chip tone="danger" icon="clock">
                Atrasado
              </Chip>
            )}
          </p>
        </div>
        {link ? (
          <Link to={link} aria-label={`Abrir ${row.label}`} className={buttonClasses({ variant: 'primary', className: 'shrink-0' })}>
            Abrir
          </Link>
        ) : (
          <button
            type="button"
            aria-label={`Marcar ${row.label} como feito`}
            disabled={busy}
            onClick={onDone}
            className={buttonClasses({ variant: 'primary', className: 'shrink-0' })}
          >
            <Icon name="check" size={18} strokeWidth={2.4} />
            Feito
          </button>
        )}
      </div>
    </section>
  )
}

/**
 * The top of Hoje: the day's ring, "N de M feitos", the goal, and the next task with its action. Without a plan nothing
 * counts toward the goal: no ring nor goal line, just the rows done.
 */
export function TodayHero({
  score,
  counted,
  done,
  total,
  partial,
  complete,
  onTarget,
  celebration,
  next,
  nextLate,
  busy,
  onDone,
}: {
  score: DayScore
  counted: boolean
  done: number
  total: number
  partial: number
  complete: boolean
  onTarget: boolean
  /** Drawn over the ring (the day-complete moment). */
  celebration?: ReactNode
  next: TodayRow | null
  nextLate: boolean
  busy: boolean
  onDone(row: TodayRow): void
}) {
  // After a "Feito" the next task takes its place under the same finger: a quick second tap must not mark it too. The
  // button stays off for a moment after each tap (the task's row is keyed by its target, so the new one is a new button).
  const [cooling, setCooling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const markDone = (row: TodayRow) => {
    if (cooling) return
    setCooling(true)
    timer.current = setTimeout(() => setCooling(false), DONE_COOLDOWN_MS)
    onDone(row)
  }
  return (
    <section aria-label="Resumo do dia" className={cardClasses({ className: 'grid gap-4' })}>
      <div className="flex items-center gap-4">
        {counted && <ProgressRing score={score}>{celebration}</ProgressRing>}
        <div className="grid min-w-0 flex-1 gap-1">
          <p role="status" className="text-xl leading-tight font-bold tracking-tight tabular-nums">
            {done} de {total} feitos
            {partial > 0 && (
              <span className="text-base font-medium tracking-normal text-muted">
                {' · '}
                {partial} {partial === 1 ? 'parcial' : 'parciais'}
              </span>
            )}
          </p>
          {counted && <DayGoalLine complete={complete} onTarget={onTarget} />}
        </div>
      </div>
      {next && (
        <NextTask row={next} late={nextLate} busy={busy || cooling} onDone={() => markDone(next)} />
      )}
    </section>
  )
}
