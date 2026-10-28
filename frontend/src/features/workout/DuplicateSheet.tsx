import { useState } from 'react'
import { deleteSessionAndMark } from '../../data/adherenceLinks'
import { useData } from '../../data/dataContext'
import type { SessionSummary } from '../../data/workoutRepo'
import { useSync } from '../sync/syncContext'
import { Button } from '../../ui/Button'
import { ListRow } from '../../ui/ListRow'
import { Sheet } from '../../ui/Sheet'
import { cardClasses } from '../../ui/styles'
import type { DuplicatePair } from './duplicates'
import { formatShortDate, formatVolume } from './format'

const summaryText = ({ setCount, volume }: SessionSummary) => `${setCount} ${setCount === 1 ? 'série' : 'séries'}, ${formatVolume(volume)}`

/**
 * "Manter só um": the same workout recorded in the app and in Hevy. The one not kept is deleted from the app with its
 * sets (the normal delete, through the outbox); a deleted Hevy workout does not come back on the next sync. `onDone`
 * gets the id of the deleted session.
 */
export function DuplicateSheet({
  pair,
  dayName,
  onDone,
  onCancel,
}: {
  pair: DuplicatePair
  dayName: string
  onDone(deletedId: string): void
  onCancel(): void
}) {
  const data = useData()
  const { syncNow } = useSync()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function keep(dropped: SessionSummary) {
    if (!data || busy) return
    setBusy(true)
    setError(false)
    try {
      await deleteSessionAndMark(data.db, data.userId, dropped.session.id, new Date())
      void syncNow()
      onDone(dropped.session.id)
    } catch (e) {
      console.error('could not delete the duplicate session', e)
      setError(true)
      setBusy(false)
    }
  }

  return (
    <Sheet title="Manter só um registro" onCancel={busy ? () => {} : onCancel}>
      <p className="text-sm text-muted">
        {dayName} de {formatShortDate(pair.app.session.date)} está no app e no Hevy. O registro que você não escolher é excluído do app; um treino
        do Hevy excluído não volta na sincronização.
      </p>
      <ul className={cardClasses({ tone: 'list' })}>
        <li>
          <ListRow title="Manter o do app" subtitle={<span className="tabular-nums">{summaryText(pair.app)}</span>} onClick={() => void keep(pair.hevy)} />
        </li>
        <li>
          <ListRow
            title="Manter o do Hevy"
            subtitle={<span className="tabular-nums">{summaryText(pair.hevy)}</span>}
            onClick={() => void keep(pair.app)}
          />
        </li>
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          Não foi possível excluir o outro registro.
        </p>
      )}
      <Button disabled={busy} onClick={onCancel}>
        Cancelar
      </Button>
    </Sheet>
  )
}
