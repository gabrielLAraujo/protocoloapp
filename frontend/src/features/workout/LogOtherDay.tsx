import { useId, useState } from 'react'
import { addDays, isCalendarDate } from '../../domain/calendarDate'
import { inputClass } from '../plans/styles'
import type { DayLimits } from '../today/dayParam'
import { Button } from '../../ui/Button'
import { SectionHeader } from '../../ui/SectionHeader'
import { cardClasses, GROUP_LABEL } from '../../ui/styles'
import { formatShortDate } from './format'
import { planForDay } from './logDay'
import type { WorkoutPlanEntry } from './workoutPlans'

const optionClass =
  'flex min-h-13 w-full items-center px-4 py-2.5 text-left text-base hover:bg-raised active:bg-raised disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/**
 * "Registrar treino de outro dia": a date before today (back to the limit of Hoje) and the plan day that was done. Picking
 * the day starts the session in log mode.
 */
export function LogOtherDay({
  plans,
  today,
  limits,
  initialDate,
  busy,
  onStart,
  onCancel,
}: {
  plans: readonly WorkoutPlanEntry[]
  today: string
  limits: DayLimits
  /** The day asked for (`?dia=` from Hoje), else yesterday. */
  initialDate: string | null
  busy: boolean
  onStart(date: string, planVersionId: string, dayKey: string): void
  onCancel(): void
}) {
  const inputId = useId()
  const errorId = useId()
  const max = addDays(today, -1)
  const min = limits.min
  const [date, setDate] = useState(() => initialDate ?? max)
  const valid = isCalendarDate(date) && date >= min && date <= max
  const plan = valid ? planForDay(date, plans) : undefined

  return (
    <section aria-label="Registrar treino de outro dia" className="grid gap-1">
      <SectionHeader title="Registrar treino de outro dia" />
      {min > max ? (
        <p className={cardClasses({ className: 'text-sm text-muted' })}>Não há dias anteriores no ciclo em andamento.</p>
      ) : (
        <div className="grid gap-5">
          <div className={cardClasses({ className: 'grid gap-2' })}>
            <label htmlFor={inputId} className="text-sm font-semibold text-muted">
              Data do treino
            </label>
            <input
              id={inputId}
              type="date"
              min={min}
              max={max}
              value={date}
              aria-invalid={!valid || undefined}
              aria-describedby={valid ? undefined : errorId}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            {!valid && (
              <p id={errorId} role="alert" className="text-sm text-danger">
                Escolha um dia entre {formatShortDate(min)} e {formatShortDate(max)}.
              </p>
            )}
          </div>
          {plan && (
            <div className="grid gap-2">
              <h3 className={GROUP_LABEL}>Treino feito</h3>
              <ul className={cardClasses({ tone: 'list' })}>
                {plan.document.days.map((d) => (
                  <li key={d.key}>
                    <button type="button" className={optionClass} disabled={busy} onClick={() => onStart(date, plan.id, d.key)}>
                      <span className="font-medium text-ink">{d.name}</span>
                      {d.notes ? <span className="text-muted">{` — ${d.notes}`}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <Button variant="ghost" className="mt-2" onClick={onCancel}>
        Cancelar
      </Button>
    </section>
  )
}
