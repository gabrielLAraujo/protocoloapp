import { Link } from 'react-router'
import { Icon } from '../../ui/Icon'
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
  // The dot repeats the state in color; the text says it.
  let dot = 'bg-ok'
  if (running) [label, dot] = ['Sincronizando…', 'bg-accent']
  else if (!online) [label, dot] = [withPending('Offline', pending), 'bg-muted']
  else if (lastError) [label, dot] = [withPending('Erro ao sincronizar', pending), 'bg-danger']
  else if (pending > 0) [label, dot] = [pendingLabel(pending), 'bg-warn']
  else if (!lastSyncAt) [label, dot] = ['Nunca sincronizado', 'bg-muted']

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span role="status" className="text-muted">
          {label}
        </span>
      </span>
      {rejected > 0 && (
        <Link
          to="/sync"
          className="flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-danger focus-visible:outline-2 focus-visible:outline-danger"
        >
          <Icon name="alert" size={18} />
          {rejected} com problema
        </Link>
      )}
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={running}
        aria-label="Sincronizar agora"
        title="Sincronizar agora"
        className="grid size-11 place-items-center rounded-control text-accent hover:bg-accent-soft disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Icon name="sync" size={20} className={running ? 'animate-spin motion-reduce:animate-none [animation-direction:reverse]' : ''} />
      </button>
    </div>
  )
}
