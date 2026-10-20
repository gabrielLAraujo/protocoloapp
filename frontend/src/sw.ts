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

// Exercise demonstrations (GIFs of the catalog) are cached as they are seen, so the web app shows them offline (the native
// app has no service worker, so no offline GIF cache there).
// static.exercisedb.dev sends no Access-Control-Allow-Origin, so the <img> responses are opaque (status 0). Trade-offs:
// - an opaque response cannot be inspected, so a failed fetch that still came back as an opaque response (e.g. a 404) is
//   cached too; the worker cannot know the image later failed to decode. It is only a stale miss: the page shows the
//   placeholder and the entry ages out;
// - browsers pad each opaque entry to several MB in the storage quota, hence the low entry cap (60) and
//   purgeOnQuotaError, which drops this cache first when the quota is hit. The page also asks for persistent storage.
const EXERCISE_GIF_URL = /^https:\/\/static\.exercisedb\.dev\/media\/.+\.gif$/
registerRoute(
  ({ request, url }) => request.destination === 'image' && EXERCISE_GIF_URL.test(url.href),
  new CacheFirst({
    cacheName: 'exercise-gifs',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 90 * 24 * 60 * 60, purgeOnQuotaError: true }),
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
