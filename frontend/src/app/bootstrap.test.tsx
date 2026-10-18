import { screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_LOCK } from '../platform/locks'
import { fakeLocks } from '../test/fakeLocks'
import { bootstrap } from './bootstrap'

const roots: { unmount(): void }[] = []
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
})

const tab = () => document.body.appendChild(document.createElement('div'))

describe('bootstrap', () => {
  it('starts the app in the first tab and holds the lock while it is open', async () => {
    const locks = fakeLocks()
    const renderApp = vi.fn((root: { render(node: React.ReactNode): void }) => root.render(<p>app</p>))

    await act(async () => {
      roots.push(await bootstrap(tab(), renderApp, locks))
    })

    expect(renderApp).toHaveBeenCalledTimes(1)
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(locks.held.has(APP_LOCK)).toBe(true)
  })

  it('a second tab only says the app is open elsewhere', async () => {
    const locks = fakeLocks()
    const first = vi.fn()
    const second = vi.fn()

    await act(async () => {
      roots.push(await bootstrap(tab(), first, locks))
      roots.push(await bootstrap(tab(), second, locks))
    })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(screen.getByText('O app está aberto em outra aba.')).toBeInTheDocument()
  })

  it('starts normally when the browser has no Web Locks', async () => {
    const renderApp = vi.fn()
    await act(async () => {
      roots.push(await bootstrap(tab(), renderApp, undefined))
    })
    expect(renderApp).toHaveBeenCalledTimes(1)
  })
})
