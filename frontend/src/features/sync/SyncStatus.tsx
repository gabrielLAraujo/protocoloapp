import { Link } from 'react-router'
import { useSync } from './syncContext'

const pendingLabel = (n: number) => `${n} ${n === 1 ? 'pendente' : 'pendentes'}`

const withPending = (text: string, n: number) => (n > 0 ? `${text} — ${pendingLabel(n)}` : text)

/**
 * Compact sync state for the header: what is waiting, whether it is running, and what needs attention.
 * "Sincronizado" only after a complete run, and never while the last run failed.
 */
export function SyncStatus() {
  const { pending, rejected, running, online, lastError, lastSyncAt, syncNow } = useSync()

  let label = 'Sincronizado'
  if (running) label = 'Sincronizando…'
  else if (!online) label = withPending('Offline', pending)
  else if (lastError) label = withPending('Erro ao sincronizar', pending)
  else if (pending > 0) label = pendingLabel(pending)
  else if (!lastSyncAt) label = 'Nunca sincronizado'

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
      <span role="status" className="text-muted">
        {label}
      </span>
      {rejected > 0 && (
        <Link
          to="/sync"
          className="rounded-control bg-danger/10 px-2 py-1 font-medium text-danger focus-visible:outline-2 focus-visible:outline-danger"
        >
          {rejected} com problema
        </Link>
      )}
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={running}
        className="rounded-control px-2 py-1 text-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        Sincronizar agora
      </button>
    </div>
  )
}
