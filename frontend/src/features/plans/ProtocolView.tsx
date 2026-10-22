import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { planRepo } from '../../data/planRepo'
import { parseProtocolDocument, type ProtocolDocument } from '../../domain/planDocuments'
import { useSync } from '../sync/syncContext'
import { CATEGORY_LABELS, formatDayMonth, formatInstantDayMonth, scheduleSummary, TIMING_GROUPS, timingGroup, withMealText } from './labels'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { Chip } from '../../ui/Chip'
import { SectionHeader } from '../../ui/SectionHeader'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'

type State = { status: 'loading' } | { status: 'none' } | { status: 'unreadable' } | { status: 'ok'; doc: ProtocolDocument; since: string | null }

function guidelineText(g: ProtocolDocument['guidelines'][number]): string {
  if (g.kind === 'water_min_l') return `Água: no mínimo ${g.value} L por dia`
  if (g.kind === 'free_meals_per_week') return `Refeições livres por semana: ${g.value}`
  return g.text ?? ''
}

/** The active protocol, read-only, from the device (works offline). */
export function ProtocolView() {
  const data = useData()
  const { dataVersion } = useSync()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!data) return
    let cancelled = false
    planRepo
      .getActive(data.db, 'protocol')
      .then((plan) => {
        if (cancelled) return
        if (!plan) return setState({ status: 'none' })
        const parsed = parseProtocolDocument(plan.document)
        setState(parsed.ok ? { status: 'ok', doc: parsed.value, since: plan.activatedAt } : { status: 'unreadable' })
      })
      .catch((e: unknown) => {
        console.error('could not read the protocol', e)
        if (!cancelled) setState({ status: 'unreadable' })
      })
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])

  const back = (
    <Link to="/planejamento" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
      <Icon name="chevronLeft" size={18} />
      Planejamento
    </Link>
  )
  if (state.status === 'loading') return <p className="text-muted">Carregando…</p>
  if (state.status === 'none') {
    return (
      <div className="grid gap-2">
        {back}
        <EmptyState icon="plan">Nenhum protocolo ativo. Envie o PDF em Planejamento.</EmptyState>
      </div>
    )
  }
  if (state.status === 'unreadable') {
    return (
      <div className="grid gap-2">
        {back}
        <EmptyState icon="alert">Não foi possível ler o protocolo ativo.</EmptyState>
      </div>
    )
  }

  const { doc, since } = state
  const dates = [
    doc.updateDate && `Atualização em ${formatDayMonth(doc.updateDate)}`,
    doc.billingDate && `Cobrança em ${formatDayMonth(doc.billingDate)}`,
    since && `Ativo desde ${formatInstantDayMonth(since)}`,
  ].filter(Boolean)
  const groups = TIMING_GROUPS.map((g) => ({ ...g, items: doc.items.filter((item) => timingGroup(item.timing) === g.id) })).filter((g) => g.items.length > 0)
  const cardio = doc.cardio
    ? [
        doc.cardio.daily ? 'Todos os dias' : doc.cardio.sessionsPerWeek != null && `${doc.cardio.sessionsPerWeek}x por semana`,
        doc.cardio.durationMin != null && `${doc.cardio.durationMin} min`,
        doc.cardio.intensity,
        doc.cardio.preferredTime,
      ].filter(Boolean)
    : []

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        {back}
        <h1 className="text-xl font-bold tracking-tight">{doc.phaseName || 'Protocolo'}</h1>
        {dates.length > 0 && <p className="text-xs text-muted">{dates.join(' · ')}</p>}
      </header>

      {/* Desktop: the meals on the left; supplements, cardio and guidelines on the right. */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-8">
        {doc.meals.length > 0 && (
          <section aria-labelledby="protocol-meals" className="grid gap-2">
            <SectionHeader id="protocol-meals" title="Refeições" />
            {doc.meals.map((meal) => {
              const name = meal.label || meal.key
              return (
                <article key={meal.key} aria-label={name} className={cardClasses({ className: 'grid gap-2' })}>
                  <h3 className="text-base font-semibold text-ink">{name}</h3>
                  {meal.items.length > 0 && (
                    <table aria-label={`Alimentos: ${name}`} className="w-full border-collapse text-sm">
                      <thead className="sr-only">
                        <tr>
                          <th scope="col">Alimento</th>
                          <th scope="col">Quantidade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {meal.items.map((item, i) => (
                          <tr key={i}>
                            <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                              {item.food}
                            </th>
                            <td className="py-2 text-right whitespace-nowrap text-ink tabular-nums">{item.grams != null ? `${item.grams} g` : null}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {meal.notes && <p className="text-xs text-muted">{meal.notes}</p>}
                </article>
              )
            })}
          </section>
        )}

        <div className="grid gap-5">
          {groups.length > 0 && (
            <section aria-labelledby="protocol-items" className="grid gap-2">
              <SectionHeader id="protocol-items" title="Suplementos e compostos" />
              {groups.map((g) => (
                <section key={g.id} aria-label={g.label} className="grid gap-1">
                  <h3 className="text-sm font-semibold text-muted">{g.label}</h3>
                  <ul className={cardClasses({ tone: 'list' })}>
                    {g.items.map((item) => (
                      <li key={item.key} className="flex items-start justify-between gap-3 p-4">
                        <div className="grid min-w-0 gap-0.5">
                          <p className="text-base font-medium text-ink">{item.name}</p>
                          <p className="text-xs text-muted">
                            {[withMealText(item.timing, doc.meals), scheduleSummary(item.schedule)].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {item.doseText && <span className="text-sm text-ink tabular-nums">{item.doseText}</span>}
                          <Chip>{CATEGORY_LABELS[item.category] ?? item.category}</Chip>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          )}

          {cardio.length > 0 && (
            <section aria-labelledby="protocol-cardio" className="grid gap-2">
              <SectionHeader id="protocol-cardio" title="Cardio" />
              <ul className={cardClasses({ tone: 'list' })}>
                {cardio.map((c, i) => (
                  <li key={i} className="p-4 text-sm text-ink">
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(doc.guidelines.length > 0 || doc.trainingSplitNote) && (
            <section aria-labelledby="protocol-guidelines" className="grid gap-2">
              <SectionHeader id="protocol-guidelines" title="Orientações" />
              <ul className={cardClasses({ tone: 'list' })}>
                {doc.guidelines.map((g, i) => (
                  <li key={i} className="p-4 text-sm text-ink">
                    {guidelineText(g)}
                  </li>
                ))}
                {doc.trainingSplitNote && <li className="p-4 text-xs text-muted">{doc.trainingSplitNote}</li>}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
