import { useSyncExternalStore } from 'react'
import { installUpdate, isUpdateWaiting, subscribeToUpdate } from './serviceWorker'

/** "Nova versão disponível" for the web app (installed PWA or browser tab): the new files are already cached, a reload applies them. */
export function WebUpdateBanner() {
  const waiting = useSyncExternalStore(subscribeToUpdate, isUpdateWaiting)
  if (!waiting) return null

  return (
    <div role="status" className="border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <strong className="font-semibold">Nova versão disponível</strong>
        <button
          type="button"
          onClick={() => void installUpdate()}
          className="rounded-control px-2 py-1 font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Atualizar
        </button>
      </div>
    </div>
  )
}
