import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'

// The "a new version is waiting" state lives here (one service worker per page), outside React, so the banner can read it
// with useSyncExternalStore whenever it mounts.
let waiting = false
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined
const listeners = new Set<() => void>()

/**
 * Registers the service worker that makes the web app installable and available offline. Never in the native app: there the
 * files are inside the APK and a worker would only add a second cache.
 */
export function registerServiceWorker(): void {
  if (Capacitor.isNativePlatform()) return

  applyUpdate = registerSW({
    onNeedRefresh() {
      waiting = true
      listeners.forEach((listener) => listener())
    },
  })
}

export function subscribeToUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const isUpdateWaiting = () => waiting

/** Activates the waiting version and reloads the page into it. */
export async function installUpdate(): Promise<void> {
  await applyUpdate?.(true)
}
