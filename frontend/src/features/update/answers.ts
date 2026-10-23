import type { FillOptions } from '../../domain/questionnaireTemplate'
import { fillText } from './fillText'
import type { UpdateMetrics } from './updateMetrics'

/** The parts of a questionnaire template this module reads (structural, so it does not depend on the full schema). */
export interface QuestionLike {
  key: string
  text: string
  fill?: string | null
  default?: string | null
  fillOptions?: FillOptions | null
}
export interface TemplateLike {
  title: string
  sections: { title: string; questions: QuestionLike[] }[]
}

export type AnswerSource = 'edited' | 'calculated' | 'default' | 'empty'

/**
 * A stored answer wins (even ""); otherwise a fill question with metrics is calculated (with its `fillOptions`); otherwise
 * the template's `default`; otherwise it is empty.
 */
export function resolveAnswer(q: QuestionLike, stored: string | undefined, m: UpdateMetrics | null): { text: string; source: AnswerSource } {
  if (stored !== undefined) return { text: stored, source: 'edited' }
  if (q.fill && m) {
    const text = fillText(q.fill, m, q.fillOptions)
    if (text !== '') return { text, source: 'calculated' }
  }
  if (q.default) return { text: q.default, source: 'default' }
  return { text: '', source: 'empty' }
}

/** Every answer as plain text, in the template's order: title, each section in upper case, question, answer ("—" when empty). */
export function answersAsText(t: TemplateLike, answers: Record<string, string>, m: UpdateMetrics | null): string {
  const lines = [t.title, '']
  for (const section of t.sections) {
    lines.push(section.title.toLocaleUpperCase('pt-BR'), '')
    for (const q of section.questions) {
      const { text } = resolveAnswer(q, Object.hasOwn(answers, q.key) ? answers[q.key] : undefined, m)
      lines.push(q.text, text.trim() === '' ? '—' : text, '')
    }
  }
  while (lines.at(-1) === '') lines.pop()
  return `${lines.join('\n')}\n`
}
