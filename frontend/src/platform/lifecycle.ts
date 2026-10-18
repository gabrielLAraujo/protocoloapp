import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/** Calls `fn` when the app returns to the foreground. Returns the unsubscribe. */
export function onResume(fn: () => void): () => void {
  if (Capacitor.isNativePlatform()) {
    const handle = App.addListener('resume', fn)
    return () => {
      void handle.then((h) => h.remove())
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') fn()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => document.removeEventListener('visibilitychange', onVisibility)
}

/** Calls `fn` when the device regains network. Returns the unsubscribe. */
export function onOnline(fn: () => void): () => void {
  window.addEventListener('online', fn)
  return () => window.removeEventListener('online', fn)
}
