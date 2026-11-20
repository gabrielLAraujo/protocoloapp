import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Data } from '../../data/dataContext'
import { rotationOverrideRepo, type RotationOverrideLocal } from '../../data/rotationOverrideRepo'
import { OFF } from '../../domain/planDocuments'
import { activePlanAt, resolveDay } from '../../domain/rotation'
import { useSync } from '../sync/syncContext'
import type { WorkoutPlanEntry } from '../workout/workoutPlans'
import { Button } from '../../ui/Button'
import { SectionHeader } from '../../ui/SectionHeader'
import { buttonClasses, cardClasses } from '../../ui/styles'

const now = () => new Date()

/** One choice of the "Trocar o treino de hoje" list: a full-width row of a list card. */
const optionClass =
  'flex min-h-13 w-full items-center px-4 py-2.5 text-left text-base hover:bg-raised active:bg-raised disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/**
 * "Previsto hoje: Treino A · Trocar": what the rotation (with today's swap) asks for today, and the choice of another
 * day of the active plan or "Descanso", saved as today's swap. Without an active plan, a shortcut to the planning.
 * Opening the choice moves the focus to its first item; closing it (a choice or "Cancelar") brings it back to "Trocar".
 */
export function DaySwap({
  data,
  today,
  plans,
  overrides,
  onChanged,
}: {
  data: Data
  today: string
  plans: WorkoutPlanEntry[]
  overrides: RotationOverrideLocal[]
  onChanged(): Promise<void>
}) {
  const { syncNow } = useSync()
  const [swapping, setSwapping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'save' | 'reload' | null>(null)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const wasSwapping = useRef(false)

  useEffect(() => {
    if (swapping) firstOptionRef.current?.focus()
    else if (wasSwapping.current) triggerRef.current?.focus()
    wasSwapping.current = swapping
  }, [swapping])

  if (plans.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-muted">Nenhuma ficha de treino ativa.</p>
        <Link to="/planejamento" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          Ir para o Planejamento
        </Link>
      </div>
    )
  }

  const ats = plans.map((p) => p.at)
  const resolved = resolveDay(today, ats, overrides)
  const planId = resolved.kind === 'workout' ? resolved.planVersionId : activePlanAt(today, ats)?.planVersionId
  const plan = plans.find((p) => p.id === planId)
  if (!plan || resolved.kind === 'none') return <p className="text-sm text-muted">Nenhum treino previsto hoje.</p>

  const label = resolved.kind === 'off' ? 'Descanso' : (plan.document.days.find((d) => d.key === resolved.dayKey)?.name ?? resolved.dayKey)

  const current = resolved.kind === 'off' ? OFF : resolved.dayKey

  async function choose(dayKey: string) {
    setBusy(true)
    setError(null)
    try {
      await rotationOverrideRepo.set(data.db, data.userId, today, dayKey, now())
    } catch (e) {
      console.error('could not save the override', e)
      setError('save')
      setBusy(false)
      return
    }
    void syncNow()
    setSwapping(false)
    try {
      await onChanged()
    } catch (e) {
      // The swap is saved: only the screen is out of date.
      console.error('could not reload after the override', e)
      setError('reload')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
        <span>
          Previsto hoje: <span className="font-semibold text-ink">{label}</span>
        </span>
        <span aria-hidden="true">·</span>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={swapping}
          aria-controls={panelId}
          className="min-h-11 font-semibold text-ink underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => setSwapping((open) => !open)}
        >
          Trocar
        </button>
      </p>
      {swapping && (
        <section id={panelId} aria-label="Trocar o treino de hoje" className="grid gap-1 lg:max-w-md">
          <SectionHeader title="Trocar o treino de hoje" />
          <ul className={cardClasses({ tone: 'list' })}>
            {plan.document.days.map((d, i) => (
              <li key={d.key}>
                <button
                  ref={i === 0 ? firstOptionRef : undefined}
                  type="button"
                  className={optionClass}
                  aria-current={d.key === current ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => void choose(d.key)}
                >
                  <span className="font-medium text-ink">{d.name}</span>
                  {d.notes ? <span className="text-muted">{` — ${d.notes}`}</span> : null}
                </button>
              </li>
            ))}
            <li>
              <button
                ref={plan.document.days.length === 0 ? firstOptionRef : undefined}
                type="button"
                className={optionClass}
                aria-current={current === OFF ? 'true' : undefined}
                disabled={busy}
                onClick={() => void choose(OFF)}
              >
                <span className="font-medium text-ink">Descanso</span>
              </button>
            </li>
          </ul>
          <Button variant="ghost" className="mt-2 w-fit" onClick={() => setSwapping(false)}>
            Cancelar
          </Button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error === 'save' ? 'Não foi possível trocar o treino de hoje.' : 'Treino de hoje trocado, mas não foi possível atualizar a tela.'}
        </p>
      )}
    </div>
  )
}
