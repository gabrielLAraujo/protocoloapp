import { describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_BODY,
  isSkipWaitingMessage,
  openFromNotification,
  readPush,
  showPush,
  type ClientsLike,
  type WindowLike,
} from './swHandlers'

const ORIGIN = 'https://protocolo.example.test'
const payload = (value: unknown) => ({ json: () => value })

describe('readPush', () => {
  it('reads the server payload', () => {
    expect(readPush(payload({ title: 'Protocolo', body: 'REF 2 — 12:30', url: '/hoje', tag: 'meal_m2' }))).toEqual({
      title: 'Protocolo',
      body: 'REF 2 — 12:30',
      url: '/hoje',
      tag: 'meal_m2',
    })
  })

  it.each([
    ['no data', null],
    ['data that is not JSON', { json: () => JSON.parse('not json') as unknown }],
    ['a JSON that is not an object', payload('texto')],
    ['empty fields', payload({ title: ' ', body: '', url: 7, tag: '' })],
  ])('falls back to the generic notification with %s', (_, data) => {
    expect(readPush(data)).toEqual({ title: 'Protocolo', body: FALLBACK_BODY, url: '/hoje' })
  })

  it.each(['https://outro.example.test/hoje', '//outro.example.test/x', '/\\outro.example.test', 'hoje'])('never opens %s', (url) => {
    expect(readPush(payload({ body: 'x', url })).url).toBe('/hoje')
  })
})

describe('showPush', () => {
  it('shows the notification with the icon, the tag and the page to open', async () => {
    const showNotification = vi.fn(() => Promise.resolve())

    await showPush({ showNotification }, payload({ title: 'Protocolo', body: 'Hora do cardio', url: '/hoje', tag: 'cardio' }))

    expect(showNotification).toHaveBeenCalledWith('Protocolo', {
      body: 'Hora do cardio',
      icon: '/pwa-192.png',
      tag: 'cardio',
      renotify: true,
      data: { url: '/hoje' },
    })
  })

  it('still shows one for a push without data (iOS drops subscriptions that show nothing)', async () => {
    const showNotification = vi.fn(() => Promise.resolve())

    await showPush({ showNotification }, null)

    expect(showNotification).toHaveBeenCalledWith('Protocolo', { body: FALLBACK_BODY, icon: '/pwa-192.png', data: { url: '/hoje' } })
  })
})

describe('openFromNotification', () => {
  const windowAt = (url: string, navigate?: WindowLike['navigate']): WindowLike & { focus: ReturnType<typeof vi.fn> } => ({
    url,
    focus: vi.fn(() => Promise.resolve()),
    ...(navigate && { navigate }),
  })
  const clientsWith = (windows: WindowLike[]) => {
    const clients = {
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn(() => Promise.resolve(null)),
    } satisfies ClientsLike
    return clients
  }

  it('focuses the open app and takes it to the page', async () => {
    const navigate = vi.fn(() => Promise.resolve())
    const open = windowAt(`${ORIGIN}/treino`, navigate)
    const clients = clientsWith([windowAt('https://outro.example.test/'), open])

    await openFromNotification(clients, { url: '/hoje' }, ORIGIN)

    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(open.focus).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/hoje`)
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('only focuses when the app is already on the page', async () => {
    const navigate = vi.fn(() => Promise.resolve())
    const open = windowAt(`${ORIGIN}/hoje`, navigate)

    await openFromNotification(clientsWith([open]), { url: '/hoje' }, ORIGIN)

    expect(open.focus).toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('still navigates when the focus is refused', async () => {
    const navigate = vi.fn(() => Promise.resolve())
    const open = windowAt(`${ORIGIN}/treino`, navigate)
    open.focus.mockRejectedValue(new Error('InvalidAccessError'))

    await openFromNotification(clientsWith([open]), { url: '/hoje' }, ORIGIN)

    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/hoje`)
  })

  it('opens a window when the app is not open', async () => {
    const clients = clientsWith([])

    await openFromNotification(clients, { url: '/hoje' }, ORIGIN)

    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/hoje`)
  })

  it('opens the page when the open window cannot be navigated', async () => {
    const clients = clientsWith([windowAt(`${ORIGIN}/`, () => Promise.reject(new TypeError('not controlled')))])

    await openFromNotification(clients, { url: '/hoje' }, ORIGIN)

    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/hoje`)
  })

  it('goes to /hoje when the notification has no usable page', async () => {
    const clients = clientsWith([])

    await openFromNotification(clients, { url: 'https://outro.example.test/' }, ORIGIN)
    await openFromNotification(clients, undefined, ORIGIN)

    expect(clients.openWindow.mock.calls).toEqual([[`${ORIGIN}/hoje`], [`${ORIGIN}/hoje`]])
  })
})

describe('isSkipWaitingMessage', () => {
  it('recognizes the message of the "Atualizar" button only', () => {
    expect(isSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(true)
    expect(isSkipWaitingMessage({ type: 'OTHER' })).toBe(false)
    expect(isSkipWaitingMessage('SKIP_WAITING')).toBe(false)
    expect(isSkipWaitingMessage(null)).toBe(false)
  })
})
