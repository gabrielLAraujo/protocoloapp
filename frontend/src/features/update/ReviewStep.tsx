import type { UpdateCycleLocal } from '../../data/updateCycleRepo'
import type { QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { GROUP_LABEL, cardClasses } from '../../ui/styles'
import { resolveAnswer } from './answers'
import type { LoadedMetrics } from './metricsCache'

export type ReviewAction = 'pdf' | 'text' | 'zip' | 'sent'

/**
 * Revisar e enviar: every answer as it will go, then the outputs (PDF by the browser's print, plain text, the photos'
 * zip) and "Marcar como enviada". The PDF is not offered in the APK (no print there).
 */
export function ReviewStep({
  template,
  cycle,
  answers,
  metrics,
  native,
  busy,
  message,
  onAction,
}: {
  template: QuestionnaireTemplate | null
  cycle: UpdateCycleLocal
  /** The stored answers with the edits still being typed. */
  answers: Record<string, string>
  metrics: LoadedMetrics | null
  native: boolean
  busy: ReviewAction | null
  message: { kind: 'status' | 'alert'; text: string } | null
  onAction(action: ReviewAction): void
}) {
  const sent = cycle.status === 'sent'
  return (
    <div className="grid gap-6">
      {template && (
        <div className="grid gap-5">
          {template.sections.map((section, i) => (
            <section key={`${i}-${section.title}`} className="grid gap-2" aria-labelledby={`review-section-${i}`}>
              <h2 id={`review-section-${i}`} className={GROUP_LABEL}>
                {section.title}
              </h2>
              <dl className={cardClasses({ tone: 'list' })}>
                {section.questions.map((q) => {
                  const { text } = resolveAnswer(q, Object.hasOwn(answers, q.key) ? answers[q.key] : undefined, metrics?.metrics ?? null)
                  const empty = text.trim() === ''
                  return (
                    <div key={q.key} className="grid gap-1 p-4">
                      <dt className="text-sm font-semibold [overflow-wrap:anywhere]">{q.text}</dt>
                      <dd className={`text-sm whitespace-pre-line [overflow-wrap:anywhere] ${empty ? 'text-muted' : ''}`}>
                        {empty ? 'Sem resposta' : text}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          ))}
        </div>
      )}

      <section aria-labelledby="review-outputs" className="grid gap-2">
        <h2 id="review-outputs" className={GROUP_LABEL}>
          Para enviar ao coach
        </h2>
        <div className={cardClasses({ className: 'grid gap-4' })}>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            {!native && template && (
              <Button icon="plan" loading={busy === 'pdf'} disabled={busy !== null} onClick={() => onAction('pdf')}>
                Gerar PDF
              </Button>
            )}
            {template && (
              <Button icon="note" loading={busy === 'text'} disabled={busy !== null} onClick={() => onAction('text')}>
                Copiar texto
              </Button>
            )}
            <Button
              icon="upload"
              loading={busy === 'zip'}
              disabled={busy !== null || cycle.photos.length === 0}
              onClick={() => onAction('zip')}
            >
              Baixar fotos (.zip)
            </Button>
          </div>
          {message && (
            <p role={message.kind} className={`text-sm ${message.kind === 'alert' ? 'text-danger' : 'text-muted'}`}>
              {message.text}
            </p>
          )}
          <div className="grid gap-2 border-t border-line pt-4">
            {sent ? (
              <p className="text-sm font-medium text-ok">Atualização marcada como enviada.</p>
            ) : (
              <p className="text-sm text-muted">Depois de mandar ao coach, marque aqui. As respostas ficam guardadas como foram.</p>
            )}
            <Button
              variant={sent ? 'secondary' : 'primary'}
              icon="check"
              className="justify-self-start"
              loading={busy === 'sent'}
              disabled={busy !== null}
              onClick={() => onAction('sent')}
            >
              {sent ? 'Marcar como enviada de novo' : 'Marcar como enviada'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
