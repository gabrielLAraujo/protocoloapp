import { afterEach, describe, expect, it, vi } from 'vitest'
import { planVersionSync } from '../data/planRepo'
import { scheduleRepo } from '../data/scheduleRepo'
import { protocolDocument } from '../features/plans/fixtures'
import { json, mockFetch, problem } from '../test/fetch-mock'
import { newLocalDb, USER_A } from '../test/localDb'
import {
  base64UrlToBytes,
  describeTest,
  disableReminders,
  enableReminders,
  pushSupport,
  refreshSubscription,
  ReminderError,
  sendTest,
} from './push'

const native = vi.hoisted(() => ({ value: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

// Fictitious keys: an uncompressed P-256 point is 65 bytes starting with 0x04.
const keyBytes = (seed: number) => Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * seed) % 256))
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const SERVER_KEY = keyBytes(7)
const OTHER_KEY = keyBytes(11)
const ENDPOINT = 'https://web.push.apple.com/fictitious-endpoint'
const SUBSCRIPTION_KEYS = { p256dh: 'BFictitiousP256dhKey', auth: 'FictitiousAuth' }

type FakeSubscription = ReturnType<typeof fakeSubscription>
function fakeSubscription(key: Uint8Array, endpoint = ENDPOINT) {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    unsubscribe: vi.fn(() => Promise.resolve(true)),
    toJSON: () => ({ endpoint, keys: SUBSCRIPTION_KEYS }),
  }
}

interface Environment {
  userAgent?: string
  standalone?: boolean
  serviceWorker?: boolean
  pushManager?: boolean
  notification?: boolean
  permission?: NotificationPermission
  answer?: NotificationPermission
  existing?: FakeSubscription | null
}

function environment({
  userAgent = ANDROID,
  standalone,
  serviceWorker = true,
  pushManager = true,
  notification = true,
  permission = 'default',
  answer = 'granted',
  existing = null,
}: Environment = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const created = fakeSubscription(SERVER_KEY)
  const pushManagerApi = {
    getSubscription: vi.fn(() => Promise.resolve(existing)),
    subscribe: vi.fn((_options: PushSubscriptionOptionsInit) => Promise.resolve(created)),
  }
  if (serviceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager: pushManagerApi }) }, configurable: true })
  }
  if (pushManager) vi.stubGlobal('PushManager', class {})
  else Reflect.deleteProperty(globalThis, 'PushManager')
  const requestPermission = vi.fn(() => {
    state.permission = answer
    return Promise.resolve(answer)
  })
  const state = { permission, requestPermission }
  if (notification) vi.stubGlobal('Notification', state)
  return { pushManager: pushManagerApi, created, requestPermission }
}

afterEach(() => {
  native.value = false
  Reflect.deleteProperty(navigator, 'standalone')
  Reflect.deleteProperty(navigator, 'maxTouchPoints')
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

async function deps() {
  const db = await newLocalDb()
  await planVersionSync.applyRemote(db, {
    entity: 'plan_version',
    id: '7d1f2a10-0000-5000-8000-0000000000b0',
    version: 1,
    payload: { kind: 'protocol', status: 'active', document: protocolDocument(), activated_at: '2026-10-10T15:00:00.000Z', low_confidence: [] },
    deletedAt: null,
    clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
  })
  return { db, userId: USER_A, syncNow: vi.fn(() => Promise.resolve()) }
}

const serverRoutes = (subscribe: () => Response = () => new Response(null, { status: 204 })) => ({
  'GET /api/push/public-key': () => json({ publicKey: toBase64Url(SERVER_KEY) }),
  'POST /api/push/subscribe': subscribe,
})

describe('pushSupport', () => {
  it('is "needs-install" in iOS Safari outside the Home Screen app (no PushManager there)', () => {
    environment({ userAgent: IPHONE, standalone: false, pushManager: false })
    expect(pushSupport()).toBe('needs-install')
  })

  it('is "needs-install" on an iPad that reports a desktop Mac (MacIntel with a touch screen)', () => {
    environment({ userAgent: IPAD_DESKTOP, standalone: false, pushManager: false })
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    // jsdom has no maxTouchPoints.
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })

    expect(pushSupport()).toBe('needs-install')
  })

  it('is "unsupported" in the native app (no service worker there), whatever the browser APIs', () => {
    environment({ permission: 'granted' })
    native.value = true

    expect(pushSupport()).toBe('unsupported')
  })

  it('is the permission in the iOS Home Screen app', () => {
    environment({ userAgent: IPHONE, standalone: true, permission: 'default' })
    expect(pushSupport()).toBe('default')
  })

  it.each([
    ['service worker', { serviceWorker: false }],
    ['PushManager', { pushManager: false }],
    ['Notification', { notification: false }],
  ])('is "unsupported" without %s', (_, missing) => {
    environment(missing)
    expect(pushSupport()).toBe('unsupported')
  })

  it.each(['default', 'granted', 'denied'] as const)('reports the permission "%s"', (permission) => {
    environment({ permission })
    expect(pushSupport()).toBe(permission)
  })
})

describe('enableReminders', () => {
  it('asks the permission right away, in the gesture, before anything is awaited', async () => {
    const { requestPermission } = environment()
    mockFetch(serverRoutes())

    const result = enableReminders(await deps())

    expect(requestPermission).toHaveBeenCalledTimes(1)
    await result
  })

  it('subscribes with the server key, sends the subscription, creates the suggested times and syncs', async () => {
    const { pushManager } = environment()
    const calls = mockFetch(serverRoutes())
    const d = await deps()

    await expect(enableReminders(d)).resolves.toBe('enabled')

    const options = pushManager.subscribe.mock.calls[0]![0]
    expect(options.userVisibleOnly).toBe(true)
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(Array.from(SERVER_KEY))
    const subscribe = calls.find((c) => c.path === '/api/push/subscribe')!
    expect(JSON.parse(subscribe.body)).toEqual({ endpoint: ENDPOINT, keys: SUBSCRIPTION_KEYS, userAgent: ANDROID })
    const slots = await scheduleRepo.all(d.db)
    expect(slots.filter((s) => s.slot === 'meal_m1').map((s) => [s.dayType, s.time])).toEqual([
      ['off', '07:00'],
      ['training', '07:00'],
    ])
    expect(d.syncNow).toHaveBeenCalledTimes(1)
  })

  it('reuses a subscription made with the same key', async () => {
    const existing = fakeSubscription(SERVER_KEY, 'https://web.push.apple.com/existing')
    const { pushManager } = environment({ existing })
    const calls = mockFetch(serverRoutes())

    await enableReminders(await deps())

    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(existing.unsubscribe).not.toHaveBeenCalled()
    expect(JSON.parse(calls.find((c) => c.path === '/api/push/subscribe')!.body).endpoint).toBe('https://web.push.apple.com/existing')
  })

  it('replaces a subscription made with another key', async () => {
    const existing = fakeSubscription(OTHER_KEY, 'https://web.push.apple.com/old')
    const { pushManager } = environment({ existing })
    const calls = mockFetch(serverRoutes())

    await enableReminders(await deps())

    expect(existing.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(JSON.parse(calls.find((c) => c.path === '/api/push/subscribe')!.body).endpoint).toBe(ENDPOINT)
  })

  it('stops when the permission is denied, without calling the server', async () => {
    environment({ answer: 'denied' })
    const calls = mockFetch({})
    const d = await deps()

    await expect(enableReminders(d)).resolves.toBe('denied')

    expect(calls).toEqual([])
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('reports a dismissed prompt', async () => {
    environment({ answer: 'default' })
    mockFetch({})

    await expect(enableReminders(await deps())).resolves.toBe('dismissed')
  })

  it('says so when the server refuses the subscription', async () => {
    environment()
    mockFetch(serverRoutes(() => problem(400, { title: 'Bad Request' })))
    const d = await deps()

    await expect(enableReminders(d)).rejects.toThrow(new ReminderError('O servidor recusou a inscrição deste aparelho.'))
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('says so offline', async () => {
    environment()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    await expect(enableReminders(await deps())).rejects.toThrow(/Confira a conexão/)
  })
})

describe('disableReminders', () => {
  it('unsubscribes and tells the server', async () => {
    const existing = fakeSubscription(SERVER_KEY)
    environment({ permission: 'granted', existing })
    const calls = mockFetch({ 'DELETE /api/push/subscribe': () => new Response(null, { status: 204 }) })

    await disableReminders()

    expect(existing.unsubscribe).toHaveBeenCalled()
    expect(calls.map((c) => [c.method, c.path, JSON.parse(c.body)])).toEqual([['DELETE', '/api/push/subscribe', { endpoint: ENDPOINT }]])
  })

  it('does nothing without a subscription', async () => {
    environment({ permission: 'granted' })
    const calls = mockFetch({})

    await disableReminders()

    expect(calls).toEqual([])
  })
})

describe('refreshSubscription', () => {
  it('sends the existing subscription again', async () => {
    environment()
    const calls = mockFetch({ 'POST /api/push/subscribe': () => new Response(null, { status: 204 }) })

    await refreshSubscription(fakeSubscription(SERVER_KEY) as unknown as PushSubscription)

    expect(JSON.parse(calls[0]!.body)).toEqual({ endpoint: ENDPOINT, keys: SUBSCRIPTION_KEYS, userAgent: ANDROID })
  })

  it('ignores being offline', async () => {
    environment()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    await expect(refreshSubscription(fakeSubscription(SERVER_KEY) as unknown as PushSubscription)).resolves.toBeUndefined()
  })
})

describe('sendTest', () => {
  it('returns how many devices got it', async () => {
    mockFetch({ 'POST /api/push/test': () => json({ sent: 2, removed: 1 }) })

    const result = await sendTest()

    expect(result).toEqual({ sent: 2, removed: 1 })
    expect(describeTest(result)).toBe('Enviado para 2 aparelhos.')
    expect(describeTest({ sent: 1, removed: 0 })).toBe('Enviado para 1 aparelho.')
    expect(describeTest({ sent: 0, removed: 1 })).toMatch(/Nenhum aparelho/)
  })

  it('throws a message to show on a server error', async () => {
    mockFetch({ 'POST /api/push/test': () => problem(500) })

    await expect(sendTest()).rejects.toBeInstanceOf(ReminderError)
  })
})

describe('base64UrlToBytes', () => {
  it('decodes the unpadded base64url the server sends', () => {
    expect(Array.from(base64UrlToBytes(toBase64Url(SERVER_KEY)))).toEqual(Array.from(SERVER_KEY))
    expect(Array.from(base64UrlToBytes('-_8'))).toEqual([0xfb, 0xff])
  })
})
