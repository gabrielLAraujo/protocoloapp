import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallHint } from './InstallHint'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const HINT = 'Adicione à Tela de Início para usar offline e receber lembretes'

function useDevice(userAgent: string, { standalone, displayModeStandalone = false }: { standalone?: boolean; displayModeStandalone?: boolean } = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: displayModeStandalone && query.includes('standalone') }))
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('InstallHint', () => {
  it('is shown on iOS Safari outside the installed app', () => {
    useDevice(IPHONE, { standalone: false })

    render(<InstallHint />)

    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.getByText(/Compartilhar/)).toBeInTheDocument()
  })

  it('is hidden in the installed app (navigator.standalone)', () => {
    useDevice(IPHONE, { standalone: true })

    render(<InstallHint />)

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('is hidden in the installed app (display-mode: standalone)', () => {
    useDevice(IPHONE, { displayModeStandalone: true })

    render(<InstallHint />)

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('is hidden outside iOS', () => {
    useDevice(ANDROID)

    render(<InstallHint />)

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('goes away when dismissed and stays away on the next visit', async () => {
    useDevice(IPHONE, { standalone: false })
    const first = render(<InstallHint />)

    await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()

    first.unmount()
    render(<InstallHint />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('still works when the storage is unavailable', async () => {
    useDevice(IPHONE, { standalone: false })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    render(<InstallHint />)
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})
