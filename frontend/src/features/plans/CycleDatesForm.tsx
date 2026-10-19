import { useId, useState } from 'react'
import { api } from '../../api/client'
import { toProblem } from '../../api/problem'
import { isCalendarDate } from '../../domain/calendarDate'
import { useSync } from '../sync/syncContext'
import { buttonClass, inputClass } from './styles'

export const CYCLE_DATES_OFFLINE = 'Conecte-se à internet para salvar'

/**
 * Sets the next update date and the billing date of a protocol version on the server (PATCH cycle-dates) and syncs, so the
 * device pulls the new document. Both fields are replaced; an empty box clears the date.
 */
export function CycleDatesForm({
  planId,
  updateDate,
  billingDate,
  requireUpdateDate = false,
  onSaved,
}: {
  planId: string
  updateDate: string | null
  billingDate: string | null
  requireUpdateDate?: boolean
  onSaved?: () => void
}) {
  const { online, syncNow } = useSync()
  const uid = useId()
  const [update, setUpdate] = useState(updateDate ?? '')
  const [billing, setBilling] = useState(billingDate ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const invalid = (v: string) => v !== '' && !isCalendarDate(v)
  const blocked = !online || working || invalid(update) || invalid(billing) || (requireUpdateDate && update === '')

  const save = async () => {
    if (blocked) return
    setWorking(true)
    setError(null)
    setSaved(false)
    try {
      const { data, error: failure } = await api.PATCH('/api/plans/{id}/cycle-dates', {
        params: { path: { id: planId } },
        body: { updateDate: update === '' ? null : update, billingDate: billing === '' ? null : billing },
      })
      if (!data) {
        const errors = (failure as { errors?: Record<string, string[]> } | null)?.errors
        const first = errors ? Object.values(errors).flat()[0] : undefined
        const problem = toProblem(failure)
        setError(first ?? problem.detail ?? problem.title)
        return
      }
      await syncNow()
      setSaved(true)
      onSaved?.()
    } catch {
      setError(CYCLE_DATES_OFFLINE)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="grid gap-1">
        <label htmlFor={`${uid}-update`} className="text-sm font-medium">Próxima atualização</label>
        <input id={`${uid}-update`} type="date" className={inputClass} value={update} onChange={(e) => setUpdate(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${uid}-billing`} className="text-sm font-medium">Mensalidade</label>
        <input id={`${uid}-billing`} type="date" className={inputClass} value={billing} onChange={(e) => setBilling(e.target.value)} />
      </div>
      {!online && <p className="text-sm text-muted">{CYCLE_DATES_OFFLINE}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-ok">Datas salvas</p>}
      <button type="submit" className={`${buttonClass} w-fit`} disabled={blocked}>
        {working ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}
