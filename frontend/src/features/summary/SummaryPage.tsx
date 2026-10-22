import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CycleDatesForm } from '../plans/CycleDatesForm'
import { useData } from '../../data/dataContext'
import { adherenceRepo } from '../../data/adherenceRepo'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import { exerciseRepo } from '../../data/exerciseRepo'
import { planRepo } from '../../data/planRepo'
import { rotationOverrideRepo } from '../../data/rotationOverrideRepo'
import { scheduleRepo } from '../../data/scheduleRepo'
import { workoutRepo, type SetLocal } from '../../data/workoutRepo'
import { parseProtocolDocument } from '../../domain/planDocuments'
import { localDate } from '../checkin/localDate'
import { loadProgress, type ProgressData } from '../progress/progressData'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { loadWorkoutPlans } from '../workout/workoutPlans'
import { toDayPlans } from '../today/todayData'
import { CycleCalendar } from './CycleCalendar'
import { CycleTimeline } from './CycleTimeline'
import { StrengthByGroup } from './StrengthByGroup'
import { adherenceRates, buildSummary, formatRate, type AdherenceRate, type SummaryData, type SummaryInput } from './summaryData'
import { WeightSparkline } from './WeightSparkline'
import { buttonClasses } from '../../ui/styles'
import { Card } from '../../ui/Card'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'
import { Stat } from '../../ui/Stat'
import { EmptyState } from '../../ui/EmptyState'

interface Loaded {
  summary: SummaryData
  /** Meals and protocol items of the cycle so far; null without an active protocol. */
  rates: { diet: AdherenceRate; items: AdherenceRate } | null
  /** The active protocol version (target of the dates form), when there is one. */
  protocolId: string | null
  billingDate: string | null
  /** Streak and closed weeks (the "Sequência" and "Semanas na meta" cards); null when they could not be computed. */
  progress: ProgressData | null
}

const daysText = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

const fmt = (n: number | null, unit = '') => (n === null ? '—' : `${String(n).replace('.', ',')}${unit}`)

/** "2 feitas · 1 parcial de 4 previstas" (feminine for meals, masculine for items). */
function rateHint(rate: AdherenceRate, one: string, many: string, planned: string): string {
  if (rate.planned === 0) return 'nada previsto até hoje'
  return `${rate.done} ${rate.done === 1 ? one : many} · ${rate.partial} ${rate.partial === 1 ? 'parcial' : 'parciais'} de ${rate.planned} ${planned}`
}

/** Short caption under the diet figure, keeping the partial ones: "2 feitas · 1 parcial de 4". */
function rateCaption(rate: AdherenceRate): string {
  if (rate.planned === 0) return 'nada previsto'
  return `${rate.done} ${rate.done === 1 ? 'feita' : 'feitas'} · ${rate.partial} ${rate.partial === 1 ? 'parcial' : 'parciais'} de ${rate.planned}`
}

async function load(db: NonNullable<ReturnType<typeof useData>>['db'], today: string): Promise<Loaded> {
  const now = new Date()
  const [active, plans, exercises, progress] = await Promise.all([
    planRepo.getActive(db, 'protocol'),
    loadWorkoutPlans(db),
    exerciseRepo.all(db),
    // A failure here only hides the "Constância" cards; the rest of the summary still shows.
    loadProgress(db, localDate(now), now).catch((e: unknown) => {
      console.error('could not compute the progress', e)
      return null
    }),
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
  const [overrides, sessions, checkins, adherence, slots] = await Promise.all([
    rotationOverrideRepo.between(db, overridesFrom, to),
    workoutRepo.sessionsBetween(db, from, today),
    dailyCheckinRepo.between(db, from, to),
    adherenceRepo.between(db, from, to),
    scheduleRepo.all(db),
  ])
  const sets: SetLocal[] = (await Promise.all(sessions.map((s) => workoutRepo.setsForSession(db, s.id)))).flat()
  const cardioMarkDates = adherence.filter((l) => l.targetType === 'cardio' && l.status === 'done').map((l) => l.date)
  const summary = buildSummary({ protocol, plans: plans.map((p) => p.at), overrides, sessions, sets, checkins, exercises, cardioMarkDates }, today)
  let rates: Loaded['rates'] = null
  if (protocol && summary.cycle) {
    // Same span as the other statistics: cycle start through today (or the update date once the cycle is over).
    const statsTo = summary.cycle.end && summary.cycle.end < today ? summary.cycle.end : today
    rates = adherenceRates({ protocol, workoutPlans: toDayPlans(plans), overrides, adherence, slots }, summary.cycle.start, statsTo, new Date())
  }
  return { summary, rates, protocolId: protocol ? active!.id : null, billingDate: protocol?.document.billingDate ?? null, progress }
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

  const { summary, rates, protocolId, billingDate, progress } = loaded
  if (!summary.cycle) {
    return (
      <section className="grid gap-4">
        <h1 className="text-xl font-bold tracking-tight">Resumo</h1>
        <EmptyState
          icon="plan"
          title="Nenhum ciclo ainda"
          action={
            <Link to="/planejamento" className={buttonClasses({ variant: 'primary' })}>
              Ir para o planejamento
            </Link>
          }
        >
          Importe o protocolo para ver o ciclo.
        </EmptyState>
      </section>
    )
  }

  const { workouts, cardio } = summary
  const perfectWeeks = progress?.weeks.filter((w) => w.perfect).length ?? 0
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-bold tracking-tight">Resumo</h1>
      <CycleTimeline
        cycle={summary.cycle}
        datesForm={
          protocolId && (
            <CycleDatesForm planId={protocolId} updateDate={null} billingDate={billingDate} requireUpdateDate />
          )
        }
      />

      <section aria-labelledby="stats-title" className="grid gap-1">
        <SectionHeader id="stats-title" title="Números do ciclo" />
        <div className="grid gap-3">
          {/* Three across from ~360 px; narrower, they wrap (two, then one) instead of overflowing. */}
          <Card as="dl" className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-3">
            <Stat label="Treinos" value={String(workouts.done)} caption={`de ${workouts.planned} ${workouts.planned === 1 ? 'previsto' : 'previstos'}`} />
            {rates ? (
              <Stat label="Dieta" value={formatRate(rates.diet)} caption={rateCaption(rates.diet)} />
            ) : (
              <Stat label="Dieta" value="—" caption="sem protocolo" />
            )}
            <Stat
              label="Água"
              value={fmt(summary.water, ' L')}
              caption={summary.waterTarget === null ? 'média por dia' : `meta ${fmt(summary.waterTarget, ' L')}`}
            />
          </Card>
          <Card as="dl" tone="list">
            <ListRow
              term
              title="Cardio"
              subtitle={cardio.planned > 0 ? 'feitos / previstos até hoje' : 'dias com cardio'}
              value={cardio.planned > 0 ? `${cardio.done} de ${cardio.planned}` : String(cardio.done)}
            />
            {rates && (
              <ListRow term title="Itens do protocolo" subtitle={rateHint(rates.items, 'feito', 'feitos', 'previstos')} value={formatRate(rates.items)} />
            )}
            <ListRow term title="Sono" subtitle="média, 1–5" value={fmt(summary.sleep)} />
            <ListRow term title="Disposição ao acordar" subtitle="média, 1–5" value={fmt(summary.energyWake)} />
            <ListRow term title="Disposição no dia" subtitle="média, 1–5" value={fmt(summary.energyDay)} />
            <ListRow term title="Ansiedade" subtitle="média, 1–5" value={fmt(summary.anxiety)} />
            <ListRow term title="Check-ins" subtitle="no ciclo" value={String(summary.checkinCount)} />
          </Card>
        </div>
      </section>

      {progress && (
        <section aria-labelledby="streak-title" className="grid gap-1">
          <SectionHeader
            id="streak-title"
            title="Constância"
            action={
              <Link
                to="/conquistas"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline decoration-accent/40 underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
              >
                Ver conquistas
              </Link>
            }
          />
          <Card as="dl" className="grid grid-cols-2 gap-4">
            <Stat
              label="Sequência"
              value={daysText(progress.streak.current)}
              caption={`recorde: ${daysText(progress.cycleBest)} no ciclo, ${daysText(progress.streak.best)} no geral`}
            />
            <Stat
              label="Semanas na meta"
              value={progress.weeks.length > 0 ? `${perfectWeeks} de ${progress.weeks.length}` : '—'}
              caption={progress.weeks.length > 0 ? 'semanas fechadas com todas as metas' : 'nenhuma semana fechada ainda'}
            />
          </Card>
        </section>
      )}

      <CycleCalendar days={summary.calendar} />

      <section aria-labelledby="weight-title" className="grid gap-1">
        <SectionHeader id="weight-title" title="Peso" />
        <Card padding="sm">
          <WeightSparkline points={summary.weight} />
        </Card>
      </section>

      <StrengthByGroup strength={summary.strength} />
    </div>
  )
}
