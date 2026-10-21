import type { Schedule } from '../../domain/planDocuments'

export const CATEGORY_LABELS: Record<string, string> = {
  supplement: 'Suplemento',
  compound: 'Composto',
  hormone: 'Hormônio',
  thermogenic: 'Termogênico',
  sleep_optional: 'Sono (opcional)',
}

export const TIMING_LABELS: Record<string, string> = {
  any: 'Qualquer horário',
  fasting: 'Em jejum',
  after_meal: 'Após refeição',
  before_bed: 'Antes de dormir',
  pre_workout: 'Pré-treino',
  intra_workout: 'Intra-treino',
  post_workout: 'Pós-treino',
}

export function timingLabel(timing: string): string {
  if (timing.startsWith('with_meal:')) return `Com refeição (${timing.slice('with_meal:'.length)})`
  return TIMING_LABELS[timing] ?? timing
}

/**
 * "Com REF 1" for an item taken with a meal (`with_meal:<key>`), from the meal's label (its key when it has none or the
 * protocol has no such meal); null for any other timing.
 */
export function withMealText(timing: string, meals: readonly { key: string; label?: string | null }[]): string | null {
  if (!timing.startsWith('with_meal:')) return null
  const key = timing.slice('with_meal:'.length)
  if (!key) return null
  return `Com ${meals.find((m) => m.key === key)?.label || key}`
}

/** Moments of the day, in day order, for grouping protocol items. Unknown timings land in "other". */
export const TIMING_GROUPS = [
  { id: 'fasting', label: 'Em jejum' },
  { id: 'with_meal', label: 'Com refeições' },
  { id: 'after_meal', label: 'Após refeição' },
  { id: 'pre_workout', label: 'Pré-treino' },
  { id: 'intra_workout', label: 'Intra-treino' },
  { id: 'post_workout', label: 'Pós-treino' },
  { id: 'before_bed', label: 'Antes de dormir' },
  { id: 'any', label: 'Qualquer horário' },
  { id: 'other', label: 'Outros' },
] as const

export function timingGroup(timing: string): (typeof TIMING_GROUPS)[number]['id'] {
  const key = timing.startsWith('with_meal') ? 'with_meal' : timing
  return TIMING_GROUPS.find((g) => g.id === key && g.id !== 'other')?.id ?? 'other'
}

export const WEEKDAY_LABELS: Record<string, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
}

const SHORT_WEEKDAYS: Record<string, string> = { mon: 'seg', tue: 'ter', wed: 'qua', thu: 'qui', fri: 'sex', sat: 'sáb', sun: 'dom' }

export function scheduleSummary(schedule: Schedule): string {
  switch (schedule.type) {
    case 'daily':
      return 'Todos os dias'
    case 'weekdays':
      return (schedule.days ?? []).map((d) => SHORT_WEEKDAYS[d] ?? d).join(', ') || 'Dias da semana'
    case 'every_n_days':
      return `A cada ${schedule.n ?? '?'} dias`
    case 'training_days_only':
      return 'Só em dias de treino'
    case 'off_days_only':
      return 'Só em dias de descanso'
    default:
      return schedule.type
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "DD/MM" of a `yyyy-MM-dd` calendar date. */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

/** "DD/MM" of an instant, in the device's time zone. */
export function formatInstantDayMonth(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
