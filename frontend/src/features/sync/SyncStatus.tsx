import { Link } from 'react-router'
import { Icon } from '../../ui/Icon'
import { useSync } from './syncContext'

const pendingLabel = (n: number) => `${n} ${n === 1 ? 'pendente' : 'pendentes'}`

const withPending = (text: string, n: number) => (n > 0 ? `${text} — ${pendingLabel(n)}` : text)

/**
 * Compact sync state for the header: the sync button with a state dot. The state is always announced (role=status); its
 * text is shown only when something needs a look (an error or entries waiting), otherwise it is for screen readers only.
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
  const visible = !running && (Boolean(lastError) || pending > 0)

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1 text-sm">
      <span role="status" className={visible ? `font-medium tabular-nums ${lastError ? 'text-danger' : 'text-muted'}` : 'sr-only'}>
        {label}
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
        className="relative grid size-11 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Icon name="sync" size={20} className={running ? 'animate-spin motion-reduce:animate-none [animation-direction:reverse]' : ''} />
        <span aria-hidden="true" className={`absolute right-2 top-2 size-2.5 rounded-full ring-2 ring-surface ${dot}`} />
      </button>
    </div>
  )
}
