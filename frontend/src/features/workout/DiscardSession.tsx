import { useState } from 'react'
import type { Data } from '../../data/dataContext'
import { workoutRepo } from '../../data/workoutRepo'
import { buttonClass, dangerButtonClass } from '../plans/styles'
import { useSync } from '../sync/syncContext'
import { cardClasses } from '../../ui/styles'

/** "Descartar treino": drops an open session that has no sets (a workout started by mistake). */
export function DiscardSession({ data, sessionId, onDiscarded }: { data: Data; sessionId: string; onDiscarded(): void }) {
  const { syncNow } = useSync()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function discard() {
    setBusy(true)
    setError(false)
    try {
      await workoutRepo.deleteSession(data.db, data.userId, sessionId, new Date())
      void syncNow()
      onDiscarded()
    } catch (e) {
      console.error('could not discard the session', e)
      setError(true)
      setBusy(false)
    }
  }

  return (
    <>
      {confirming ? (
        <div role="group" aria-label="Confirmar descarte" className={cardClasses({ className: 'grid gap-3' })}>
          <p className="font-medium">Descartar este treino? Nada foi registrado nele.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={dangerButtonClass} disabled={busy} onClick={() => void discard()}>
              Sim, descartar
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirming(false)}>
              Manter treino
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={buttonClass} onClick={() => setConfirming(true)}>
          Descartar treino
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          Não foi possível descartar o treino.
        </p>
      )}
    </>
  )
}
