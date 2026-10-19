import { Capacitor } from '@capacitor/core'
import { api } from '../api/client'
import { ensureScheduleDefaults } from '../data/activeProtocol'
import type { LocalDb } from '../data/localDb'
import { isInstalled, isIos } from './device'

/**
 * Where the device stands for Web Push reminders:
 * - `unsupported`: no service worker, PushManager or Notification (or the native app, which has no service worker);
 * - `needs-install`: iOS Safari in a tab; push only exists in the app added to the Home Screen;
 * - otherwise the notification permission.
 */
export type PushSupport = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted'

export function pushSupport(): PushSupport {
  if (Capacitor.isNativePlatform()) return 'unsupported'
  // Before the API checks: Safari has no PushManager outside the installed app, and installing is the way to get it.
  if (isIos() && !isInstalled()) return 'needs-install'
  if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** A failure to show as is (pt-BR). */
export class ReminderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReminderError'
  }
}

const OFFLINE = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.'
const NOT_READY = 'O app ainda está terminando de instalar. Tente de novo em instantes.'
const SW_READY_TIMEOUT_MS = 10_000

/** The active service worker registration; it never resolves without one (dev server), hence the timeout. */
async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReminderError(NOT_READY)), SW_READY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** base64url (no padding, as the server sends the VAPID key) to bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false
  const view = new Uint8Array(a)
  return view.every((byte, i) => byte === b[i])
}

/** This device's push subscription, or null (also when push is not available). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'granted') return null
  try {
    return await (await registration()).pushManager.getSubscription()
  } catch {
    return null
  }
}

function subscribeBody(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) return null
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent: navigator.userAgent }
}

/**
 * Sends this device's existing subscription to the server again (an upsert by endpoint), in case the server lost it.
 * Best effort: offline or refused, nothing happens.
 */
export async function refreshSubscription(subscription: PushSubscription): Promise<void> {
  const body = subscribeBody(subscription)
  if (!body) return
  await api.POST('/api/push/subscribe', { body }).catch(() => undefined)
}

export interface ReminderDeps {
  db: LocalDb
  userId: string
  /** Pushes the schedule rows to the server (the reminders are computed from them). Never rejects. */
  syncNow: () => Promise<void>
}

export type EnableResult = 'enabled' | 'denied' | 'dismissed'

/**
 * Turns the reminders on for this device. Call it straight from the click handler, with nothing awaited before: iOS only
 * shows the permission prompt during a user gesture, so the request is the first thing done.
 * Asks the permission, subscribes with the server's VAPID key (reusing a subscription made with the same key), sends it to
 * the server, then makes sure the schedule has its suggested times and syncs them. Throws a ReminderError on failure.
 */
export async function enableReminders(deps: ReminderDeps): Promise<EnableResult> {
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'dismissed'

  const key = await api.GET('/api/push/public-key').catch(() => null)
  if (!key?.data?.publicKey) throw new ReminderError(OFFLINE)
  const applicationServerKey = base64UrlToBytes(key.data.publicKey)

  const reg = await registration()
  let subscription: PushSubscription
  try {
    const existing = await reg.pushManager.getSubscription()
    if (existing && sameBytes(existing.options.applicationServerKey, applicationServerKey)) {
      subscription = existing
    } else {
      // Made with another key (the server's keys were regenerated): the push service would refuse our pushes.
      await existing?.unsubscribe()
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    }
  } catch {
    throw new ReminderError('O aparelho não aceitou a inscrição para lembretes. Tente de novo.')
  }

  const body = subscribeBody(subscription)
  if (!body) throw new ReminderError('O aparelho devolveu uma inscrição incompleta.')
  const sent = await api.POST('/api/push/subscribe', { body }).catch(() => null)
  if (!sent) throw new ReminderError(OFFLINE)
  if (!sent.response.ok) {
    throw new ReminderError(
      sent.response.status === 400 ? 'O servidor recusou a inscrição deste aparelho.' : 'O servidor não registrou a inscrição. Tente de novo.',
    )
  }

  await ensureScheduleDefaults(deps.db, deps.userId)
  await deps.syncNow()
  return 'enabled'
}

/**
 * Turns the reminders off for this device: unsubscribes first (a push to a dead subscription makes the server drop it, so
 * this already stops them), then tells the server, best effort.
 */
export async function disableReminders(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  const { endpoint } = subscription
  try {
    await subscription.unsubscribe()
  } catch {
    throw new ReminderError('Não foi possível desativar neste aparelho. Tente de novo.')
  }
  // Offline: the server removes it on the next reminder (the push service answers 404/410).
  await api.DELETE('/api/push/subscribe', { body: { endpoint } }).catch(() => undefined)
}

/** Asks the server for a test push to every device of the user. Throws a ReminderError on failure. */
export async function sendTest(): Promise<{ sent: number; removed: number }> {
  const result = await api.POST('/api/push/test').catch(() => null)
  if (!result) throw new ReminderError(OFFLINE)
  if (!result.data) throw new ReminderError('O servidor não enviou o teste. Tente de novo.')
  return result.data
}

/** "Enviado para N aparelho(s)" and the like, for sendTest's result. */
export function describeTest({ sent }: { sent: number; removed: number }): string {
  if (sent === 0) return 'Nenhum aparelho recebeu o teste. Ative os lembretes de novo.'
  return sent === 1 ? 'Enviado para 1 aparelho.' : `Enviado para ${sent} aparelhos.`
}
