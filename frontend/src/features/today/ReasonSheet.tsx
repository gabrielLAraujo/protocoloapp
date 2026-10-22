import { useId, useState } from 'react'
import { MAX_NOTE_LENGTH, reasonsFor, type AdherenceReason } from '../../data/adherenceRepo'
import type { AdherenceTargetType } from '../../domain/dayPlan'
import { inputClass } from '../plans/styles'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { REASON_LABELS } from './todayData'

/**
 * The quick reasons for "½ Parcial" / "✗ Não fiz" ("Acabou" only for a protocol item). A reason saves at once; "Outro"
 * asks for an optional note first.
 * Escape or "Cancelar" closes without saving (focus handling: Sheet). While a choice is being saved the buttons are
 * aria-disabled, not disabled: a disabled button drops the focus to the page, outside the sheet.
 */
export function ReasonSheet({
  title,
  targetType,
  busy,
  onPick,
  onCancel,
}: {
  title: string
  targetType: AdherenceTargetType
  busy: boolean
  onPick(reason: AdherenceReason, note: string | null): void
  onCancel(): void
}) {
  const noteId = useId()
  const [other, setOther] = useState(false)
  const [note, setNote] = useState('')

  return (
    <Sheet title={title} onCancel={onCancel} focusKey={other}>
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
            {reasonsFor(targetType).map((reason) => (
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
    </Sheet>
  )
}
