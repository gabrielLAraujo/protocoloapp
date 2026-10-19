import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isNativePlatform = vi.fn(() => false)
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }))

const updateSW = vi.fn(() => Promise.resolve())
type Options = { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, registration?: { update: () => Promise<void> }) => void }
const registerSW = vi.fn((_options?: Options) => updateSW)
vi.mock('virtual:pwa-register', () => ({ registerSW: (options?: Options) => registerSW(options) }))

// The module keeps the "update waiting" state, so every test starts from a fresh copy.
async function load() {
  vi.resetModules()
  const worker = await import('./serviceWorker')
  const { WebUpdateBanner } = await import('./WebUpdateBanner')
  return { ...worker, WebUpdateBanner }
}

beforeEach(() => {
  isNativePlatform.mockReturnValue(false)
  registerSW.mockClear()
  updateSW.mockClear()
})

describe('registerServiceWorker', () => {
  it('registers in the browser', async () => {
    const { registerServiceWorker } = await load()

    registerServiceWorker()

    expect(registerSW).toHaveBeenCalledTimes(1)
  })

  it('is skipped in the native app', async () => {
    isNativePlatform.mockReturnValue(true)
    const { registerServiceWorker } = await load()

    registerServiceWorker()

    expect(registerSW).not.toHaveBeenCalled()
  })
})

describe('WebUpdateBanner', () => {
  it('shows nothing until a new version is waiting', async () => {
    const { registerServiceWorker, WebUpdateBanner } = await load()
    registerServiceWorker()

    render(<WebUpdateBanner />)

    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument()
  })

  it('offers the update when a new version is waiting and applies it with a reload', async () => {
    const { registerServiceWorker, WebUpdateBanner } = await load()
    registerServiceWorker()
    render(<WebUpdateBanner />)

    act(() => registerSW.mock.calls[0]![0]!.onNeedRefresh!())
    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))

    expect(updateSW).toHaveBeenCalledWith(true)
  })
})

describe('update checks', () => {
  afterEach(() => vi.useRealTimers())

  async function registered() {
    vi.useFakeTimers()
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    const registration = { update: vi.fn(() => Promise.resolve()) }
    registerSW.mock.calls[0]![0]!.onRegisteredSW!('/sw.js', registration)
    return registration
  }

  it('checks every hour', async () => {
    const registration = await registered()

    vi.advanceTimersByTime(59 * 60 * 1000)
    expect(registration.update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60 * 1000)

    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('checks when the app returns to the foreground, not when it goes away', async () => {
    const registration = await registered()
    const visibility = vi.spyOn(document, 'visibilityState', 'get')

    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('stops checking once stopped', async () => {
    const { watchForUpdates } = await load()
    vi.useFakeTimers()
    const registration = { update: vi.fn(() => Promise.resolve()) }

    watchForUpdates(registration)()
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(registration.update).not.toHaveBeenCalled()
  })

  it('ignores a failed check (offline)', async () => {
    const { watchForUpdates } = await load()
    vi.useFakeTimers()
    const update = vi.fn(() => Promise.reject(new Error('offline')))

    const stop = watchForUpdates({ update })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(update).toHaveBeenCalledTimes(1)
    stop()
  })
})
