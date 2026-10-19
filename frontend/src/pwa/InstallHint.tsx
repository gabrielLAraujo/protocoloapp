import { useState } from 'react'

const DISMISSED_KEY = 'protocolo:install-hint-dismissed'

function isIos(): boolean {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  // iPadOS 13+ reports itself as a Mac, but has a touch screen.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
}

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
    <div role="note" className="border-b border-line bg-surface px-4 py-2 text-sm">
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
          className="rounded-control px-2 py-1 font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Dispensar
        </button>
      </div>
    </div>
  )
}
