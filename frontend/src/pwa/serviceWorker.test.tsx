import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isNativePlatform = vi.fn(() => false)
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }))

const updateSW = vi.fn(() => Promise.resolve())
const registerSW = vi.fn((_options?: { onNeedRefresh?: () => void }) => updateSW)
vi.mock('virtual:pwa-register', () => ({ registerSW: (options?: { onNeedRefresh?: () => void }) => registerSW(options) }))

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
