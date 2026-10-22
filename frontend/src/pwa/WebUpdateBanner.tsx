import { useSyncExternalStore } from 'react'
import { installUpdate, isUpdateWaiting, subscribeToUpdate } from './serviceWorker'
import { buttonClasses } from '../ui/styles'

/** "Nova versão disponível" for the web app (installed PWA or browser tab): the new files are already cached, a reload applies them. */
export function WebUpdateBanner() {
  const waiting = useSyncExternalStore(subscribeToUpdate, isUpdateWaiting)
  if (!waiting) return null

  return (
    <div role="status" className="border-b border-line bg-raised px-4 py-1 text-sm">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <strong className="font-semibold">Nova versão disponível</strong>
        <button
          type="button"
          onClick={() => void installUpdate()}
          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
        >
          Atualizar
        </button>
      </div>
    </div>
  )
}
