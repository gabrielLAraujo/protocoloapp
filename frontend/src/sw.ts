// The service worker (vite-plugin-pwa `injectManifest`): precaches the app shell, serves it for navigations offline, and shows
// the reminders the server sends by Web Push. Type-checked by tsconfig.sw.json (WebWorker lib).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { isSkipWaitingMessage, NAVIGATE_FALLBACK_DENYLIST, openFromNotification, showPush } from './pwa/swHandlers'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: NAVIGATE_FALLBACK_DENYLIST }))

// A new version waits until the user taps "Atualizar" (registerType 'prompt'); the page reloads once it takes control.
self.addEventListener('message', (event) => {
  if (isSkipWaitingMessage(event.data)) void self.skipWaiting()
})

self.addEventListener('push', (event) => {
  event.waitUntil(showPush(self.registration, event.data))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(self.clients, event.notification.data, self.location.origin))
})
