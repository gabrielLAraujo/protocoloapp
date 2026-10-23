import { muscleGroupFromApi, muscleGroupLabel } from '../../domain/muscleGroups'
import { REASON_LABELS } from '../today/todayData'
import type { MetricsAvg, MetricsTrend, UpdateMetrics } from './updateMetrics'

const NO_DATA = 'Sem dados no ciclo.'

/** Reason codes of the metrics: the adherence reasons plus the two the server adds. */
const REASONS: Record<string, string> = { ...REASON_LABELS, unmarked: 'Sem registro', deviation: 'Fora do plano' }

const decimal = (v: number, digits: number) => v.toFixed(digits).replace('.', ',')
const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${decimal(Math.abs(v), digits)}`
const kg = (v: number) => `${decimal(v, 2)} kg`
/** yyyy-MM-dd → dd/MM. */
const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const reasons = (list: { reason: string; count: number }[]) =>
  list.length === 0 ? '' : ` (${list.map((r) => `${REASONS[r.reason] ?? r.reason} ${r.count}`).join(', ')})`
/** The pt-BR label of a muscle group as the server sends it (`lowerBack` or `lower_back`); an unknown one as it came. */
const groupLabel = (group: string) => {
  const known = muscleGroupFromApi(group)
  return known ? muscleGroupLabel(known) : group
}
const days = (n: number) => plural(n, 'dia', 'dias')
const scale = (a: MetricsAvg) => (a.avg === null ? 'sem dados' : `${decimal(a.avg, 1)} de 5 em ${days(a.days)}`)
const trendText = (t: MetricsTrend) => `${t.name} ${signed(t.delta, 1)} kg (${decimal(t.firstE1rm, 1)} → ${decimal(t.lastE1rm, 1)})`

const missed = (planned: number, done: number, one: string, many: string, dates: string[] = []) => {
  if (planned === 0) return NO_DATA
  const lost = Math.max(0, planned - done)
  if (lost === 0) return `Nenhum ${one} perdido (${done} de ${planned} feito${done === 1 ? '' : 's'}).`
  const when = dates.length === 0 ? '' : ` (${dates.map(dayMonth).join(', ')})`
  return `${lost} de ${planned} ${many} perdido${lost === 1 ? '' : 's'}${when}.`
}

const writers: Record<string, (m: UpdateMetrics) => string> = {
  diet_error_pct: ({ dietErrorPct: { cycle, weeks } }) => {
    if (cycle.errorPct === null) return NO_DATA
    const head = `Ciclo: ${Math.round(cycle.errorPct)}% de erro (${cycle.done} de ${cycle.planned} refeições certas).`
    const byWeek = weeks.map((w) => `Semana ${w.week}: ${w.errorPct === null ? 'sem dados' : `${Math.round(w.errorPct)}%`}`)
    return byWeek.length === 0 ? head : `${head} ${byWeek.join(' · ')}`
  },
  diet_wrong_meals: ({ dietWrongMeals }) =>
    dietWrongMeals.length === 0
      ? NO_DATA
      : dietWrongMeals
          .map((w) =>
            w.count === 0
              ? `Semana ${w.week}: nenhuma refeição errada`
              : `Semana ${w.week}: ${plural(w.count, 'refeição errada', 'refeições erradas')}${reasons(w.reasons)}`,
          )
          .join('\n'),
  diet_deviations: ({ dietDeviations }) =>
    dietDeviations.length === 0
      ? 'Nenhum desvio no ciclo.'
      : dietDeviations
          .map((d) => {
            const when = [dayMonth(d.date), d.time?.slice(0, 5)].filter(Boolean).join(' ')
            const meal = d.mealLabel ? ` · ${d.mealLabel}` : ''
            const qty = d.quantity ? ` (${d.quantity})` : ''
            return `${when}${meal}: ${d.description}${qty}`
          })
          .join('\n'),
  missed_workouts: ({ missedWorkouts: w }) => missed(w.planned, w.done, 'treino', 'treinos', w.missedDates),
  missed_cardio: ({ missedCardio: c }) => missed(c.planned, c.done, 'cardio', 'cardios'),
  items_missed: ({ itemsMissed }) =>
    itemsMissed.length === 0
      ? 'Nenhum item deixado de usar.'
      : itemsMissed.map((i) => `${i.name}: ${plural(i.missed, 'vez', 'vezes')}${reasons(i.reasons)}`).join('\n'),
  strength_changes: ({ strengthChanges }) => {
    const groups = strengthChanges.filter((g) => g.best.length + g.worst.length > 0)
    if (groups.length === 0) return 'Sem dados suficientes.'
    return groups
      .map((g) => {
        const parts = [
          g.best.length > 0 ? `melhores ${g.best.map(trendText).join(', ')}` : null,
          g.worst.length > 0 ? `piores ${g.worst.map(trendText).join(', ')}` : null,
        ].filter(Boolean)
        return `${groupLabel(g.group)}: ${parts.join('; ')}`
      })
      .join('\n')
  },
  training_changes: ({ trainingChanges }) =>
    trainingChanges.length === 0
      ? 'Nenhuma mudança no treino.'
      : trainingChanges
          .map((c) => {
            const name = c.exerciseName ?? 'exercício'
            if (c.kind === 'plan_activated') return `${dayMonth(c.date)}: nova ficha${c.exerciseName ? ` ${c.exerciseName}` : ''}`
            if (c.kind === 'swapped') return `${dayMonth(c.date)}: ${name} trocado${c.replacementName ? ` por ${c.replacementName}` : ''}`
            return `${dayMonth(c.date)}: ${name} pulado`
          })
          .join('\n'),
  weight: ({ weight: w }) => {
    if (w.start === null && w.end === null) return NO_DATA
    const start = w.start === null ? 'sem pesagem' : kg(w.start.kg)
    const end = w.end === null ? 'sem pesagem' : kg(w.end.kg)
    const delta = w.deltaKg === null ? '' : ` (${signed(w.deltaKg, 2)} kg)`
    return `Início ${start} · fim ${end}${delta}`
  },
  water_avg: ({ waterAvg: w }) => {
    if (w.avgL === null) return NO_DATA
    const target = w.targetL === null ? '' : ` (meta ${decimal(w.targetL, 2)} L)`
    return `Média de ${decimal(w.avgL, 2)} L por dia em ${days(w.days)}${target}.`
  },
  sleep_avg: ({ sleepAvg }) => (sleepAvg.avg === null ? NO_DATA : `Média ${scale(sleepAvg)}.`),
  energy_avg: ({ energyAvg: { wake, day } }) =>
    wake.avg === null && day.avg === null ? NO_DATA : `Ao acordar: ${scale(wake)} · Durante o dia: ${scale(day)}`,
  anxiety_avg: ({ anxietyAvg }) => (anxietyAvg.avg === null ? NO_DATA : `Média ${scale(anxietyAvg)}.`),
  checkin_notes: ({ checkinNotes }) =>
    checkinNotes.length === 0 ? 'Nenhuma nota no ciclo.' : checkinNotes.map((n) => `${dayMonth(n.date)}: ${n.note}`).join('\n'),
}

/** The pt-BR answer text of a fill metric; an unknown metric gives "". */
export function fillText(metric: string, m: UpdateMetrics): string {
  return Object.hasOwn(writers, metric) ? writers[metric](m) : ''
}
