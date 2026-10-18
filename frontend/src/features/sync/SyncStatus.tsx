import { Link } from 'react-router'
import { useSync } from './syncContext'

const pendingLabel = (n: number) => `${n} ${n === 1 ? 'pendente' : 'pendentes'}`

/** Compact sync state for the header: what is waiting, whether it is running, and what needs attention. */
export function SyncStatus() {
  const { pending, rejected, running, online, syncNow } = useSync()

  let label = 'Sincronizado'
  if (running) label = 'Sincronizando…'
  else if (!online) label = pending > 0 ? `Offline — ${pendingLabel(pending)}` : 'Offline'
  else if (pending > 0) label = pendingLabel(pending)

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
