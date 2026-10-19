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
