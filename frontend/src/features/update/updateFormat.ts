import type { QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { posesOf } from '../../domain/questionnaireTemplate'
import type { UpdateCycleLocal } from '../../data/updateCycleRepo'
import { diffDays } from '../../domain/calendarDate'

/** yyyy-MM-dd (or an ISO timestamp, read in local time) → dd/MM. */
export function dayMonth(value: string): string {
  if (value.length === 10) return `${value.slice(8, 10)}/${value.slice(5, 7)}`
  const d = new Date(value)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "dd/MM a dd/MM". */
export const periodText = (cycle: Pick<UpdateCycleLocal, 'periodStart' | 'periodEnd'>) => `${dayMonth(cycle.periodStart)} a ${dayMonth(cycle.periodEnd)}`

/**
 * How far the cycle is: photos of the template's poses, and the questions answered (a stored text, or a question the
 * metrics fill or with a default while no edit replaced it).
 */
export function cycleProgress(cycle: UpdateCycleLocal, template: QuestionnaireTemplate | null) {
  const poses = posesOf(template)
  const photos = poses.filter((p) => cycle.photos.some((x) => x.pose === p.key)).length
  const questions = template?.sections.flatMap((s) => s.questions) ?? []
  const answered = questions.filter((q) => {
    const stored = Object.hasOwn(cycle.answers, q.key) ? cycle.answers[q.key] : undefined
    return stored === undefined ? !!q.fill || !!q.default?.trim() : stored.trim() !== ''
  }).length
  return { photos, poses: poses.length, answered, questions: questions.length }
}

/** The card shows from this many days before the update date until the update is sent (late included). */
export const CARD_DAYS_BEFORE = 3

export function dueText(today: string, updateDate: string): string {
  const days = diffDays(today, updateDate)
  if (days > 1) return `Atualização em ${days} dias`
  if (days === 1) return 'Atualização amanhã'
  if (days === 0) return 'Atualização hoje'
  const late = -days
  return `Atualização atrasada há ${late} ${late === 1 ? 'dia' : 'dias'}`
}
