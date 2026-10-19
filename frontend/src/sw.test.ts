import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NAVIGATE_FALLBACK_DENYLIST } from './pwa/swHandlers'

// The service worker's wiring, run against a fake worker scope (jsdom's `self`) with Workbox mocked. The calls are recorded
// by hand: the module runs once (in beforeAll), and mock call histories are cleared between tests.
const workbox = vi.hoisted(() => {
  const calls: [string, ...unknown[]][] = []
  return {
    calls,
    precacheAndRoute: (...args: unknown[]) => void calls.push(['precacheAndRoute', ...args]),
    cleanupOutdatedCaches: () => void calls.push(['cleanupOutdatedCaches']),
    createHandlerBoundToURL: (url: string) => ({ boundTo: url }),
    registerRoute: (route: unknown) => void calls.push(['registerRoute', route]),
    NavigationRoute: class {
      handler: unknown
      options: unknown
      constructor(handler: unknown, options: unknown) {
        this.handler = handler
        this.options = options
      }
    },
  }
})
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: workbox.precacheAndRoute,
  cleanupOutdatedCaches: workbox.cleanupOutdatedCaches,
  createHandlerBoundToURL: workbox.createHandlerBoundToURL,
}))
vi.mock('workbox-routing', () => ({ registerRoute: workbox.registerRoute, NavigationRoute: workbox.NavigationRoute }))

const MANIFEST = [{ url: 'index.html', revision: 'r1' }]
const listeners = new Map<string, (event: unknown) => void>()
const worker = {
  __WB_MANIFEST: MANIFEST,
  skipWaiting: vi.fn(() => Promise.resolve()),
  registration: { showNotification: vi.fn(() => Promise.resolve()) },
  clients: { matchAll: vi.fn(() => Promise.resolve([])), openWindow: vi.fn(() => Promise.resolve(null)) },
}

beforeAll(async () => {
  Object.assign(self, worker)
  vi.spyOn(self, 'addEventListener').mockImplementation((type: string, listener: unknown) => {
    listeners.set(type, listener as (event: unknown) => void)
  })
  // A variable path: sw.ts belongs to the WebWorker TypeScript project (tsconfig.sw.json), not to this one.
  const entry = './sw'
  await import(/* @vite-ignore */ entry)
})

const dispatch = (type: string, event: Record<string, unknown>) => {
  const waits: Promise<unknown>[] = []
  listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) })
  return Promise.all(waits)
}

describe('service worker', () => {
  it('precaches the build manifest and serves the app shell for navigations outside the denylist', () => {
    expect(workbox.calls).toEqual([
      ['precacheAndRoute', MANIFEST],
      ['cleanupOutdatedCaches'],
      ['registerRoute', { handler: { boundTo: '/index.html' }, options: { denylist: NAVIGATE_FALLBACK_DENYLIST } }],
    ])
    expect(NAVIGATE_FALLBACK_DENYLIST.map(String)).toEqual(['/^\\/api\\//', '/^\\/health/', '/^\\/openapi/', '/^\\/scalar/'])
  })

  // Review Focus 5: the "Atualizar" button (updateSW(true) → workbox-window messageSkipWaiting) still activates the new worker.
  it('takes over on the SKIP_WAITING message of the update banner, and only on it', () => {
    listeners.get('message')!({ data: { type: 'OTHER' } })
    expect(worker.skipWaiting).not.toHaveBeenCalled()

    listeners.get('message')!({ data: { type: 'SKIP_WAITING' } })
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('shows a notification for a push', async () => {
    await dispatch('push', { data: { json: () => ({ title: 'Protocolo', body: 'Check-in do dia', url: '/hoje', tag: 'checkin' }) } })

    expect(worker.registration.showNotification).toHaveBeenCalledWith('Protocolo', expect.objectContaining({ body: 'Check-in do dia', tag: 'checkin' }))
  })

  it('closes the notification and opens the app on a click', async () => {
    const close = vi.fn()

    await dispatch('notificationclick', { notification: { close, data: { url: '/hoje' } } })

    expect(close).toHaveBeenCalled()
    expect(worker.clients.openWindow).toHaveBeenCalledWith(`${self.location.origin}/hoje`)
  })
})
