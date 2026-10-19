/**
 * The service worker's logic (src/sw.ts wires it to the events). Kept apart and typed with the few members it uses, so it
 * type-checks with both the DOM and the WebWorker libs and the tests can run it in jsdom.
 */

/** Navigations that must reach the network, never the cached app shell. */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [/^\/api\//, /^\/health/, /^\/openapi/, /^\/scalar/]

export const NOTIFICATION_TITLE = 'Protocolo'
export const DEFAULT_URL = '/hoje'
/** Shown when a push arrives without a readable payload: iOS revokes a subscription that gets a push without a notification. */
export const FALLBACK_BODY = 'Você tem lembretes para hoje.'
/** An existing PWA icon (frontend/public). No badge: Android needs a monochrome one, and the app has none. */
export const NOTIFICATION_ICON = '/pwa-192.png'

export interface PushContent {
  title: string
  body: string
  url: string
  tag?: string
}

/** `workbox-window`'s `messageSkipWaiting()` (the "Atualizar" button) posts this to the waiting worker. */
export function isSkipWaitingMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING'
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** Only a path of this app: anything else (another origin, `//host`) falls back to /hoje. */
function safePath(value: unknown): string {
  if (!nonEmpty(value) || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_URL
  return value
}

/**
 * Reads the server's payload `{title, body, url, tag}`. Missing, non-JSON or malformed data gives the generic notification,
 * so every push shows one.
 */
export function readPush(data: { json(): unknown } | null | undefined): PushContent {
  let raw: unknown = null
  try {
    raw = data?.json() ?? null
  } catch {
    raw = null
  }
  const payload = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const content: PushContent = {
    title: nonEmpty(payload.title) ? payload.title : NOTIFICATION_TITLE,
    body: nonEmpty(payload.body) ? payload.body : FALLBACK_BODY,
    url: safePath(payload.url),
  }
  if (nonEmpty(payload.tag)) content.tag = payload.tag
  return content
}

export interface NotificationTarget {
  showNotification(title: string, options?: NotificationOptions): Promise<void>
}

/** The `push` event: always shows a notification. */
export async function showPush(registration: NotificationTarget, data: { json(): unknown } | null | undefined): Promise<void> {
  const content = readPush(data)
  const options: NotificationOptions = { body: content.body, icon: NOTIFICATION_ICON, data: { url: content.url } }
  if (content.tag) options.tag = content.tag
  await registration.showNotification(content.title, options)
}

export interface WindowLike {
  url: string
  focus(): Promise<unknown>
  navigate?(url: string): Promise<unknown>
}

export interface ClientsLike {
  matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>
  openWindow(url: string): Promise<unknown>
}

/** The `notificationclick` event: focuses an open window of the app and takes it to the notification's page, or opens one. */
export async function openFromNotification(clients: ClientsLike, notificationData: unknown, origin: string): Promise<void> {
  const path = safePath((notificationData as { url?: unknown } | null | undefined)?.url)
  const target = new URL(path, origin).href
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((w) => {
    try {
      return new URL(w.url).origin === origin
    } catch {
      return false
    }
  })
  if (!open) {
    await clients.openWindow(target)
    return
  }
  await open.focus()
  if (open.url === target) return
  try {
    if (!open.navigate) throw new Error('navigate unsupported')
    await open.navigate(target)
  } catch {
    // An uncontrolled window cannot be navigated by the worker: open the page instead.
    await clients.openWindow(target)
  }
}
