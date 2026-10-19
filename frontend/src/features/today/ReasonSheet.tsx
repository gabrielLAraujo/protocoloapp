import { useEffect, useId, useRef, useState } from 'react'
import { ADHERENCE_REASONS, MAX_NOTE_LENGTH, type AdherenceReason } from '../../data/adherenceRepo'
import { buttonClass, inputClass } from '../plans/styles'
import { REASON_LABELS } from './todayData'

/**
 * The quick reasons for "½ Parcial" / "✗ Não fiz". A reason saves at once; "Outro" asks for an optional note first.
 * Escape or "Cancelar" closes without saving.
 */
export function ReasonSheet({
  title,
  busy,
  onPick,
  onCancel,
}: {
  title: string
  busy: boolean
  onPick(reason: AdherenceReason, note: string | null): void
  onCancel(): void
}) {
  const titleId = useId()
  const noteId = useId()
  const [other, setOther] = useState(false)
  const [note, setNote] = useState('')
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button, textarea')?.focus()
  }, [other])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={onCancel}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        className="mx-auto grid w-full max-w-2xl gap-3 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {other ? (
          <>
            <label htmlFor={noteId} className="text-sm font-medium">
              Observação (opcional)
            </label>
            <textarea
              id={noteId}
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick('other', note.trim() ? note.trim() : null)}
                className="min-h-11 flex-1 rounded-control bg-accent px-4 font-semibold text-on-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Salvar
              </button>
              <button type="button" className={`${buttonClass} flex-1`} onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Qual foi o motivo?</p>
            <div className="grid grid-cols-2 gap-2">
              {ADHERENCE_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={busy}
                  className={buttonClass}
                  onClick={() => (reason === 'other' ? setOther(true) : onPick(reason, null))}
                >
                  {REASON_LABELS[reason]}
                </button>
              ))}
            </div>
            <button type="button" className={buttonClass} onClick={onCancel}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
