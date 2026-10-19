import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CycleDatesForm } from '../plans/CycleDatesForm'
import { useData } from '../../data/dataContext'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { exerciseRepo } from '../../data/exerciseRepo'
import { planRepo } from '../../data/planRepo'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { workoutRepo, type SetLocal } from '../../data/workoutRepo'
import { parseProtocolDocument } from '../../domain/planDocuments'
import { localDate } from '../checkin/localDate'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { loadWorkoutPlans } from '../workout/workoutPlans'
import { CycleCalendar } from './CycleCalendar'
import { CycleTimeline } from './CycleTimeline'
import { StatCard } from './StatCard'
import { StrengthByGroup } from './StrengthByGroup'
import { buildSummary, type SummaryData, type SummaryInput } from './summaryData'
import { WeightSparkline } from './WeightSparkline'

interface Loaded {
  summary: SummaryData
  /** The active protocol version (target of the dates form), when there is one. */
  protocolId: string | null
  billingDate: string | null
}

const fmt = (n: number | null, unit = '') => (n === null ? '—' : `${String(n).replace('.', ',')}${unit}`)

async function load(db: NonNullable<ReturnType<typeof useData>>['db'], today: string): Promise<Loaded> {
  const [active, plans, exercises] = await Promise.all([
    planRepo.getActive(db, 'protocol'),
    loadWorkoutPlans(db),
    exerciseRepo.all(db),
  ])

  let protocol: SummaryInput['protocol'] = null
  if (active?.activatedAt) {
    const parsed = parseProtocolDocument(active.document)
    if (parsed.ok) protocol = { activatedOn: localDate(new Date(active.activatedAt)), document: parsed.value }
  }
  const from = protocol?.activatedOn ?? today
  const to = protocol?.document.updateDate && protocol.document.updateDate > today ? protocol.document.updateDate : today
  // Overrides re-anchor the rotation cumulatively from each workout version's activation (see rotation.ts), so load
  // them since the first activation, not just since the cycle start - otherwise the calendar can differ from /treino.
  const overridesFrom = plans.map((p) => p.at.activatedOn).sort()[0] ?? '0000-01-01'
  const [overrides, sessions, checkins] = await Promise.all([
    rotationOverrideRepo.between(db, overridesFrom, to),
    workoutRepo.sessionsBetween(db, from, today),
    dailyCheckinRepo.between(db, from, to),
  ])
  const sets: SetLocal[] = (await Promise.all(sessions.map((s) => workoutRepo.setsForSession(db, s.id)))).flat()
  const summary = buildSummary({ protocol, plans: plans.map((p) => p.at), overrides, sessions, sets, checkins, exercises }, today)
  return { summary, protocolId: protocol ? active!.id : null, billingDate: protocol?.document.billingDate ?? null }
}

/** `/`: the cycle at a glance - timeline, calendar, adherence, check-in averages, weight and strength. */
export function SummaryPage() {
  const data = useData()
  const today = useToday()
  const { dataVersion } = useSync()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    load(data.db, today).then(
      (result) => {
        if (!cancelled) {
          setLoaded(result)
          setFailed(false)
        }
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
    // A finished sync can bring new data; reload then.
  }, [data, today, dataVersion])

  if (failed) return <p role="alert" className="text-danger">Não foi possível carregar o resumo.</p>
  if (!loaded) return <p className="text-muted">Carregando…</p>

  const { summary, protocolId, billingDate } = loaded
  if (!summary.cycle) {
    return (
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Resumo</h1>
        <p>Importe o protocolo para ver o ciclo.</p>
        <Link to="/planejamento" className="min-h-11 w-fit rounded-control bg-accent px-4 py-2.5 font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-accent">
          Ir para o planejamento
        </Link>
      </section>
    )
  }

  const { workouts, cardio } = summary
  return (
    <div className="grid gap-5">
      <h1 className="text-xl font-semibold tracking-tight">Resumo</h1>
      <CycleTimeline
        cycle={summary.cycle}
        datesForm={
          protocolId && (
            <CycleDatesForm planId={protocolId} updateDate={null} billingDate={billingDate} requireUpdateDate />
          )
        }
      />
      <CycleCalendar days={summary.calendar} />

      <section aria-labelledby="stats-title" className="grid gap-2">
        <h2 id="stats-title" className="text-base font-semibold">Números do ciclo</h2>
        <dl className="grid grid-cols-2 gap-2">
          <StatCard label="Treinos" value={`${workouts.done} de ${workouts.planned}`} hint="feitos / previstos até hoje" />
          <StatCard
            label="Cardio"
            value={cardio.planned > 0 ? `${cardio.done} de ${cardio.planned}` : String(cardio.done)}
            hint={cardio.planned > 0 ? 'feitos / previstos até hoje' : 'dias com cardio'}
          />
          <StatCard label="Sono" value={fmt(summary.sleep)} hint="média, 1–5" />
          <StatCard label="Disposição ao acordar" value={fmt(summary.energyWake)} hint="média, 1–5" />
          <StatCard label="Disposição no dia" value={fmt(summary.energyDay)} hint="média, 1–5" />
          <StatCard label="Ansiedade" value={fmt(summary.anxiety)} hint="média, 1–5" />
          <StatCard
            label="Água"
            value={fmt(summary.water, ' L')}
            hint={summary.waterTarget === null ? 'média por dia' : `média por dia, meta ${fmt(summary.waterTarget, ' L')}`}
          />
          <StatCard label="Check-ins" value={String(summary.checkinCount)} hint="no ciclo" />
        </dl>
      </section>

      <section aria-labelledby="weight-title" className="grid gap-2">
        <h2 id="weight-title" className="text-base font-semibold">Peso</h2>
        <WeightSparkline points={summary.weight} />
      </section>

      <StrengthByGroup strength={summary.strength} />
    </div>
  )
}
