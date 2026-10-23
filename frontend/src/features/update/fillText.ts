import { muscleGroupFromApi, muscleGroupLabel } from '../../domain/muscleGroups'
import type { FillOptions } from '../../domain/questionnaireTemplate'
import { REASON_LABELS } from '../today/todayData'
import type { MetricsAvg, MetricsItemUse, MetricsTrend, UpdateMetrics } from './updateMetrics'

const NO_DATA = 'Sem dados no ciclo.'
const NO_WEEK_DATA = 'Sem dados nessa semana.'
const DAY_MS = 86_400_000

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
const scale = (a: MetricsAvg, max = 5) => (a.avg === null ? 'sem dados' : `${decimal(a.avg, 1)} de ${max} em ${days(a.days)}`)
const trendText = (t: MetricsTrend) => `${t.name} ${signed(t.delta, 1)} kg (${decimal(t.firstE1rm, 1)} → ${decimal(t.lastE1rm, 1)})`

/** yyyy-MM-dd plus `n` days. */
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/** The range of week `week` of the cycle (blocks of 7 days from `from`, the last one up to `to`); null after the end. */
function weekRange(m: UpdateMetrics, week: number): { from: string; to: string } | null {
  const from = addDays(m.from, (week - 1) * 7)
  if (from > m.to) return null
  const end = addDays(from, 6)
  return { from, to: end < m.to ? end : m.to }
}

const missed = (planned: number, done: number, one: string, many: string, dates: string[] = []) => {
  if (planned === 0) return NO_DATA
  const lost = Math.max(0, planned - done)
  if (lost === 0) return `Nenhum ${one} perdido (${done} de ${planned} feito${done === 1 ? '' : 's'}).`
  const when = dates.length === 0 ? '' : ` (${dates.map(dayMonth).join(', ')})`
  return `${lost} de ${planned} ${many} perdido${lost === 1 ? '' : 's'}${when}.`
}

const itemUse = (i: MetricsItemUse) =>
  `${i.name}: ${i.done} de ${days(i.planned)}${i.partial > 0 ? ` (${i.partial} ${i.partial === 1 ? 'parcial' : 'parciais'})` : ''}`

/** The entries whose category is in `categories` (no filter when absent). */
const inCategories = <T extends { category: string | null }>(list: T[], categories: readonly string[] | null | undefined) =>
  categories ? list.filter((i) => i.category !== null && categories.includes(i.category)) : list

/** The groups in `groups` (snake_case, from the template; no filter when absent), whatever case the server sent. */
const inGroups = <T extends { group: string }>(list: T[], groups: readonly string[] | null | undefined) => {
  if (!groups) return list
  const wanted = new Set(groups.map(muscleGroupFromApi))
  return list.filter((g) => wanted.has(muscleGroupFromApi(g.group)))
}

const wrongMealsLine = (w: UpdateMetrics['dietWrongMeals'][number]) =>
  w.count === 0
    ? `Semana ${w.week}: nenhuma refeição errada`
    : `Semana ${w.week}: ${plural(w.count, 'refeição errada', 'refeições erradas')}${reasons(w.reasons)}`

const deviationLine = (d: UpdateMetrics['dietDeviations'][number]) => {
  const when = [dayMonth(d.date), d.time?.slice(0, 5)].filter(Boolean).join(' ')
  const meal = d.mealLabel ? ` · ${d.mealLabel}` : ''
  const qty = d.quantity ? ` (${d.quantity})` : ''
  return `${when}${meal}: ${d.description}${qty}`
}

type Writer = (m: UpdateMetrics, o: FillOptions) => string

/** The weekly writers: `fillOptions.week` restricts the metric to that week of the cycle. */
const weekWriters: Record<string, (m: UpdateMetrics, week: number) => string> = {
  diet_error_pct: ({ dietErrorPct: { weeks } }, week) => {
    const w = weeks.find((x) => x.week === week)
    if (!w || w.errorPct === null) return NO_WEEK_DATA
    return `Semana ${week}: ${Math.round(w.errorPct)}% de erro (${w.done} de ${w.planned} refeições certas).`
  },
  diet_wrong_meals: ({ dietWrongMeals }, week) => {
    const w = dietWrongMeals.find((x) => x.week === week)
    return w ? wrongMealsLine(w) : NO_WEEK_DATA
  },
  diet_deviations: (m, week) => {
    const range = weekRange(m, week)
    if (!range) return NO_WEEK_DATA
    const list = m.dietDeviations.filter((d) => d.date >= range.from && d.date <= range.to)
    return list.length === 0 ? 'Nenhum desvio nessa semana.' : list.map(deviationLine).join('\n')
  },
  missed_workouts: ({ missedWorkouts }, week) => {
    const w = missedWorkouts.weeks.find((x) => x.week === week)
    return w ? missed(w.planned, w.done, 'treino', 'treinos', w.missedDates) : NO_WEEK_DATA
  },
  missed_cardio: ({ missedCardio }, week) => {
    const w = missedCardio.weeks.find((x) => x.week === week)
    return w ? missed(w.planned, w.done, 'cardio', 'cardios') : NO_WEEK_DATA
  },
}

const writers: Record<string, Writer> = {
  diet_error_pct: ({ dietErrorPct: { cycle, weeks } }) => {
    if (cycle.errorPct === null) return NO_DATA
    const head = `Ciclo: ${Math.round(cycle.errorPct)}% de erro (${cycle.done} de ${cycle.planned} refeições certas).`
    const byWeek = weeks.map((w) => `Semana ${w.week}: ${w.errorPct === null ? 'sem dados' : `${Math.round(w.errorPct)}%`}`)
    return byWeek.length === 0 ? head : `${head} ${byWeek.join(' · ')}`
  },
  diet_wrong_meals: ({ dietWrongMeals }) => (dietWrongMeals.length === 0 ? NO_DATA : dietWrongMeals.map(wrongMealsLine).join('\n')),
  diet_deviations: ({ dietDeviations }) => (dietDeviations.length === 0 ? 'Nenhum desvio no ciclo.' : dietDeviations.map(deviationLine).join('\n')),
  missed_workouts: ({ missedWorkouts: w }) => missed(w.planned, w.done, 'treino', 'treinos', w.missedDates),
  missed_cardio: ({ missedCardio: c }) => missed(c.planned, c.done, 'cardio', 'cardios'),
  items_missed: ({ itemsMissed }, o) => {
    const list = inCategories(itemsMissed, o.categories)
    return list.length === 0
      ? 'Nenhum item deixado de usar.'
      : list.map((i) => `${i.name}: ${plural(i.missed, 'vez', 'vezes')}${reasons(i.reasons)}`).join('\n')
  },
  items_used: ({ itemsUsed }, o) => {
    const list = inCategories(itemsUsed, o.categories)
    return list.length === 0 ? 'Nenhum item usado.' : list.map(itemUse).join('\n')
  },
  strength_changes: ({ strengthChanges }, o) => {
    const groups = inGroups(strengthChanges, o.groups).filter((g) => g.best.length + g.worst.length > 0)
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
  stress_avg: ({ stressAvg }) => (stressAvg.avg === null ? NO_DATA : `Média ${scale(stressAvg, 10)}.`),
  mood_avg: ({ moodAvg }) => (moodAvg.avg === null ? NO_DATA : `Média ${scale(moodAvg)}.`),
  checkin_notes: ({ checkinNotes }) =>
    checkinNotes.length === 0 ? 'Nenhuma nota no ciclo.' : checkinNotes.map((n) => `${dayMonth(n.date)}: ${n.note}`).join('\n'),
}

/**
 * The pt-BR answer text of a fill metric, restricted by the question's `fillOptions` (week, categories, groups) where the
 * metric takes them; an option it does not take is ignored. An unknown metric gives "".
 */
export function fillText(metric: string, m: UpdateMetrics, options?: FillOptions | null): string {
  if (!Object.hasOwn(writers, metric)) return ''
  const o = options ?? {}
  if (o.week != null && Object.hasOwn(weekWriters, metric)) return weekWriters[metric](m, o.week)
  return writers[metric](m, o)
}
