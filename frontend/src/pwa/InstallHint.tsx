import { useState } from 'react'
import { isInstalled, isIos } from './device'
import { buttonClasses } from '../ui/styles'

const DISMISSED_KEY = 'protocolo:install-hint-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function remember(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // The hint just comes back next visit.
  }
}

/**
 * On iOS the web app only works offline (and can only get reminders) once added to the Home Screen. Shown in Safari, never in
 * the installed app, until dismissed.
 */
export function InstallHint() {
  const [visible, setVisible] = useState(() => isIos() && !isInstalled() && !wasDismissed())
  if (!visible) return null

  return (
    <div role="note" className="border-b border-line bg-surface px-4 py-3 text-sm">
      <div className="mx-auto flex max-w-2xl items-start justify-between gap-3">
        <p>
          <strong className="font-semibold">Adicione à Tela de Início para usar offline e receber lembretes</strong>
          <span className="block text-muted">Toque em Compartilhar e depois em Adicionar à Tela de Início.</span>
        </p>
        <button
          type="button"
          onClick={() => {
            remember()
            setVisible(false)
          }}
          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
        >
          Dispensar
        </button>
      </div>
    </div>
  )
}
