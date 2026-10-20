// The service worker (vite-plugin-pwa `injectManifest`): precaches the app shell, serves it for navigations offline, and shows
// the reminders the server sends by Web Push. Type-checked by tsconfig.sw.json (WebWorker lib).
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { isSkipWaitingMessage, NAVIGATE_FALLBACK_DENYLIST, openFromNotification, showPush } from './pwa/swHandlers'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: NAVIGATE_FALLBACK_DENYLIST }))

// Exercise demonstrations (GIFs of the catalog) are cached as they are seen, so they also show offline. Cross-origin images
// come back as opaque responses (status 0); they are kept too. The cache is capped by count and age.
const EXERCISE_GIF_URL = /^https:\/\/static\.exercisedb\.dev\/media\/.+\.gif$/
registerRoute(
  ({ request, url }) => request.destination === 'image' && EXERCISE_GIF_URL.test(url.href),
  new CacheFirst({
    cacheName: 'exercise-gifs',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 90 * 24 * 60 * 60 }),
    ],
  }),
)

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
