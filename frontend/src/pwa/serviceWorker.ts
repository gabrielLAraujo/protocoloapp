import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'

// The "a new version is waiting" state lives here (one service worker per page), outside React, so the banner can read it
// with useSyncExternalStore whenever it mounts.
let waiting = false
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined
const listeners = new Set<() => void>()

// An installed PWA can stay open (or be resumed) for days without a navigation, and the browser only looks for a new
// sw.js on navigations: ask explicitly when the app comes back to the foreground and every hour.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Checks for a new service worker on foreground and hourly; returns the function that stops it. */
export function watchForUpdates(registration: { update: () => Promise<unknown> }): () => void {
  const check = () => void registration.update().catch(() => undefined)
  const onVisibility = () => {
    if (document.visibilityState === 'visible') check()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
  }
}

let stopWatching: (() => void) | undefined

/**
 * Registers the service worker that makes the web app installable and available offline. Never in the native app: there the
 * files are inside the APK and a worker would only add a second cache.
 */
export function registerServiceWorker(): void {
  if (Capacitor.isNativePlatform()) return

  applyUpdate = registerSW({
    onRegisteredSW(_url, registration) {
      stopWatching?.()
      stopWatching = registration ? watchForUpdates(registration) : undefined
    },
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
