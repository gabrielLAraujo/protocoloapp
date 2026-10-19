import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ADHERENCE_REASONS, MAX_NOTE_LENGTH, type AdherenceReason } from '../../data/adherenceRepo'
import { inputClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { REASON_LABELS } from './todayData'

/**
 * The quick reasons for "½ Parcial" / "✗ Não fiz". A reason saves at once; "Outro" asks for an optional note first.
 * Escape or "Cancelar" closes without saving. Focus stays inside while it is open (Tab wraps) and goes back to the button
 * that opened it when it closes. While a choice is being saved the buttons are aria-disabled, not disabled: a disabled
 * button drops the focus to the page, outside the sheet.
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

  // The opener is whatever had the focus when the sheet mounted; it gets it back on close (when it is still on screen).
  // Declared before the effect below, so it reads the opener and not the sheet's own first button.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button, textarea')?.focus()
  }, [other])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)'))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-scrim" onClick={onCancel}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto grid w-full max-w-2xl gap-4 rounded-t-sheet border-t border-line bg-surface p-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-raised"
      >
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 id={titleId} className="text-lg font-semibold">
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
              <Button variant="primary" className="flex-1" aria-disabled={busy || undefined} onClick={() => !busy && onPick('other', note.trim() ? note.trim() : null)}>
                Salvar
              </Button>
              <Button className="flex-1" onClick={onCancel}>
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Qual foi o motivo?</p>
            <div className="grid grid-cols-2 gap-2">
              {ADHERENCE_REASONS.map((reason) => (
                <Button key={reason} size="lg" aria-disabled={busy || undefined} onClick={() => !busy && (reason === 'other' ? setOther(true) : onPick(reason, null))}>
                  {REASON_LABELS[reason]}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
