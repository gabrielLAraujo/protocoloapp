import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { planRepo } from '../../data/planRepo'
import { parseProtocolDocument, type ProtocolDocument } from '../../domain/planDocuments'
import { useSync } from '../sync/syncContext'
import { CATEGORY_LABELS, formatDayMonth, formatInstantDayMonth, scheduleSummary, timingLabel } from './labels'

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
    <Link to="/planejamento" className="text-sm font-semibold text-accent underline">
      Planejamento
    </Link>
  )
  if (state.status === 'loading') return <p className="text-muted">Carregando…</p>
  if (state.status === 'none') {
    return (
      <div className="grid gap-2">
        <p>Nenhum protocolo ativo. Envie o PDF em Planejamento.</p>
        {back}
      </div>
    )
  }
  if (state.status === 'unreadable') {
    return (
      <div className="grid gap-2">
        <p>Não foi possível ler o protocolo ativo.</p>
        {back}
      </div>
    )
  }

  const { doc, since } = state
  const card = 'grid gap-2 rounded-control border border-line bg-surface p-4'
  return (
    <div className="grid gap-4">
      {back}
      <header className="grid gap-0.5">
        <h1 className="text-xl font-semibold">{doc.phaseName || 'Protocolo'}</h1>
        <p className="text-sm text-muted">
          {[
            doc.updateDate && `Atualização em ${formatDayMonth(doc.updateDate)}`,
            doc.billingDate && `Cobrança em ${formatDayMonth(doc.billingDate)}`,
            since && `Ativo desde ${formatInstantDayMonth(since)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {doc.meals.length > 0 && (
        <section aria-label="Refeições" className={card}>
          <h2 className="text-lg font-semibold">Refeições</h2>
          {doc.meals.map((meal) => (
            <div key={meal.key}>
              <h3 className="font-medium">{meal.label || meal.key}</h3>
              <ul className="text-sm text-muted">
                {meal.items.map((item, i) => (
                  <li key={i}>
                    {item.food}
                    {item.grams != null && ` — ${item.grams} g`}
                  </li>
                ))}
              </ul>
              {meal.notes && <p className="text-sm text-muted">{meal.notes}</p>}
            </div>
          ))}
        </section>
      )}

      {doc.items.length > 0 && (
        <section aria-label="Suplementos e compostos" className={card}>
          <h2 className="text-lg font-semibold">Suplementos e compostos</h2>
          <ul className="grid gap-2">
            {doc.items.map((item) => (
              <li key={item.key}>
                <p className="font-medium">
                  {item.name}
                  {item.doseText && <span className="font-normal text-muted"> — {item.doseText}</span>}
                </p>
                <p className="text-sm text-muted">
                  {[CATEGORY_LABELS[item.category] ?? item.category, timingLabel(item.timing), scheduleSummary(item.schedule)].join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.cardio && (
        <section aria-label="Cardio" className={card}>
          <h2 className="text-lg font-semibold">Cardio</h2>
          <p className="text-sm text-muted">
            {[
              doc.cardio.daily ? 'Todos os dias' : doc.cardio.sessionsPerWeek != null && `${doc.cardio.sessionsPerWeek}x por semana`,
              doc.cardio.durationMin != null && `${doc.cardio.durationMin} min`,
              doc.cardio.intensity,
              doc.cardio.preferredTime,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </section>
      )}

      {(doc.guidelines.length > 0 || doc.trainingSplitNote) && (
        <section aria-label="Orientações" className={card}>
          <h2 className="text-lg font-semibold">Orientações</h2>
          <ul className="grid gap-1 text-sm">
            {doc.guidelines.map((g, i) => (
              <li key={i}>{guidelineText(g)}</li>
            ))}
          </ul>
          {doc.trainingSplitNote && <p className="text-sm text-muted">{doc.trainingSplitNote}</p>}
        </section>
      )}
    </div>
  )
}
