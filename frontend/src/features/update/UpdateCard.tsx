import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { updateCycleRepo, type UpdateCycleLocal } from '../../data/updateCycleRepo'
import { diffDays } from '../../domain/calendarDate'
import type { QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { Card } from '../../ui/Card'
import { Icon } from '../../ui/Icon'
import { buttonClasses } from '../../ui/styles'
import { useSync } from '../sync/syncContext'
import { CARD_DAYS_BEFORE, cycleProgress, dayMonth, dueText } from './updateFormat'

type Loaded = { cycle: UpdateCycleLocal; template: QuestionnaireTemplate | null } | null

/**
 * Hoje's reminder of the update: from 3 days before the date until it is marked as sent. Reads only the device (the
 * Atualização screen is the one that asks the server for a missing cycle).
 */
export function UpdateCard({ today }: { today: string }) {
  const data = useData()
  const { dataVersion } = useSync()
  const [loaded, setLoaded] = useState<Loaded>(null)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    Promise.all([updateCycleRepo.current(data.db), questionnaireTemplateRepo.get(data.db)]).then(
      ([cycle, template]) => {
        if (!cancelled) setLoaded(cycle ? { cycle, template: template?.document ?? null } : null)
      },
      (error: unknown) => console.error('could not read the update cycle', error instanceof Error ? error.name : 'unknown'),
    )
    return () => {
      cancelled = true
    }
  }, [data, dataVersion])

  if (!loaded) return null
  const { cycle, template } = loaded
  if (cycle.status === 'sent' || diffDays(today, cycle.periodEnd) > CARD_DAYS_BEFORE) return null

  const late = diffDays(today, cycle.periodEnd) < 0
  const p = cycleProgress(cycle, template)
  const parts = [`Fotos ${p.photos} de ${p.poses}`]
  if (template) parts.push(`Respostas ${p.answered} de ${p.questions}`)

  return (
    <Card as="section" aria-labelledby="update-card-title" tone={late ? 'warn' : 'default'} className="grid gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-control bg-raised text-muted">
          <Icon name="camera" size={18} />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h2 id="update-card-title" className={`text-base font-semibold ${late ? 'text-warn' : ''}`}>
            {dueText(today, cycle.periodEnd)}
          </h2>
          <p className="text-sm text-muted">
            Data da atualização: {dayMonth(cycle.periodEnd)}
          </p>
        </div>
      </div>
      <p className="text-sm tabular-nums">{parts.join(' · ')}</p>
      <Link to="/atualizacao" className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'justify-self-start' })}>
        Abrir atualização
      </Link>
    </Card>
  )
}
