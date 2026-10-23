import { resolveAnswer, type TemplateLike } from './answers'
import type { UpdateMetrics } from './updateMetrics'
import './print.css'

/** yyyy-MM-dd → dd/MM/yyyy. */
const fullDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

interface Props {
  template: TemplateLike
  answers: Record<string, string>
  metrics: UpdateMetrics | null
  period: { start: string; end: string }
}

/**
 * The questionnaire laid out for the browser's print (the PDF): title, period, sections, each question in bold with its answer
 * below. Hidden on screen; print.css shows only this root when printing.
 */
export function QuestionnairePrint({ template, answers, metrics, period }: Props) {
  return (
    <article data-print-root>
      <h1>{template.title}</h1>
      <p data-print-period>
        Período: {fullDate(period.start)} a {fullDate(period.end)}
      </p>
      {template.sections.map((section, i) => (
        <section key={`${i}-${section.title}`} data-print-section>
          <h2>{section.title}</h2>
          {section.questions.map((q) => {
            const { text } = resolveAnswer(q, Object.hasOwn(answers, q.key) ? answers[q.key] : undefined, metrics)
            return (
              <div key={q.key} data-print-question>
                <strong>{q.text}</strong>
                <p data-print-answer>{text.trim() === '' ? '—' : text}</p>
              </div>
            )
          })}
        </section>
      ))}
    </article>
  )
}
