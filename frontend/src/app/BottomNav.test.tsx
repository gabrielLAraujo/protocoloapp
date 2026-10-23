import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/authContext'
import { BottomNav } from './BottomNav'

const logout = vi.fn().mockResolvedValue(undefined)

/** The desktop layout (lg, ≥ 1024 px): `matchMedia` answers yes for the breakpoint query. */
function stubDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 64rem)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function setup(entry = '/', footer?: ReactNode) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Outlet />
            <BottomNav footer={footer} />
          </>
        ),
        children: ['/', '/hoje', '/treino', '/checkin', '/checkin/manha', '/checkin/noite', '/planejamento', '/configuracoes'].map((path) => ({ path, element: <p>{`tela ${path}`}</p> })),
      },
    ],
    { initialEntries: [entry] },
  )
  render(
    <AuthContext value={{ status: 'signedIn', login: vi.fn(), logout }}>
      <RouterProvider router={router} />
    </AuthContext>,
  )
  return router
}

describe('BottomNav', () => {
  it('navigates between the tabs and marks the current one', async () => {
    const user = userEvent.setup()
    const router = setup()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(screen.getByRole('link', { name: 'Resumo' })).toHaveAttribute('aria-current', 'page')

    for (const [name, path] of [['Hoje', '/hoje'], ['Treino', '/treino'], ['Planejamento', '/planejamento'], ['Resumo', '/']] as const) {
      await user.click(screen.getByRole('link', { name }))
      expect(router.state.location.pathname).toBe(path)
      expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    }
  })

  it('has Resumo, Hoje, Treino, Planejamento and Mais, and no Check-in tab', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    const names = within(nav).getAllByRole('link').map((l) => l.textContent)
    expect(names).toEqual(['Resumo', 'Hoje', 'Treino', 'Planejamento'])
    expect(within(nav).getByRole('button', { name: 'Mais' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Check-in' })).not.toBeInTheDocument()
  })

  it.each(['/checkin', '/checkin/manha', '/checkin/noite'])('"Hoje" is highlighted on the check-in it opens (%s)', (path) => {
    setup(path)
    expect(screen.getByRole('link', { name: 'Hoje' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Hoje' }).className).toContain('text-accent')
    expect(screen.getByRole('link', { name: 'Resumo' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Resumo' }).className).not.toContain('text-accent')
  })

  it('"Resumo" is not current on other routes', () => {
    setup('/treino')
    expect(screen.getByRole('link', { name: 'Resumo' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Treino' })).toHaveAttribute('aria-current', 'page')
  })

  it('"Mais" opens Configurações and Sair', async () => {
    const user = userEvent.setup()
    const router = setup()
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mais' }))
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(logout).toHaveBeenCalled()

    await user.click(screen.getByRole('link', { name: 'Configurações' }))
    expect(router.state.location.pathname).toBe('/configuracoes')
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
  })

  it('publishes its height as --bottom-nav-height', () => {
    setup()
    expect(document.documentElement.style.getPropertyValue('--bottom-nav-height')).toMatch(/px$/)
  })

  it('moves focus into the menu, traps Tab, and Escape returns focus to "Mais"', async () => {
    const user = userEvent.setup()
    setup()
    const more = screen.getByRole('button', { name: 'Mais' })
    await user.click(more)
    const dialog = screen.getByRole('dialog', { name: 'Mais' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const first = screen.getByRole('link', { name: 'Conquistas' })
    expect(screen.getByRole('link', { name: 'Check-in de hoje' })).toHaveAttribute('href', '/checkin')
    expect(screen.getByRole('link', { name: 'Atualização' })).toHaveAttribute('href', '/atualizacao')
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument()
    const exit = screen.getByRole('button', { name: 'Sair' })
    expect(first).toHaveAttribute('href', '/conquistas')
    expect(first).toHaveFocus()

    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(exit).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
    await user.tab({ shift: true })
    expect(exit).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('closing with the "Mais" button or the backdrop also returns focus to it', async () => {
    const user = userEvent.setup()
    setup()
    const more = screen.getByRole('button', { name: 'Mais' })
    await user.click(more)
    await user.click(more)
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('is the bottom bar on the phone (no matchMedia match)', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav).not.toHaveAttribute('data-layout', 'sidebar')
    expect(nav).toHaveClass('bottom-0')
  })
})

describe('BottomNav on the desktop (lg)', () => {
  it('is a fixed left sidebar with the mark, the same tabs and the "Mais" items as direct entries', () => {
    stubDesktop()
    setup('/', <p>estado da sincronização</p>)
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav).toHaveAttribute('data-layout', 'sidebar')
    expect(nav).toHaveClass('fixed', 'left-0', 'inset-y-0')
    expect(within(nav).getByText('Protocolo')).toBeInTheDocument()
    const names = within(nav).getAllByRole('link').map((l) => l.textContent)
    expect(names).toEqual(['Resumo', 'Hoje', 'Treino', 'Planejamento', 'Conquistas', 'Check-in de hoje', 'Atualização', 'Configurações'])
    expect(within(nav).getByRole('button', { name: 'Sair' })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Mais' })).not.toBeInTheDocument()
    // The sync state sits at its foot.
    expect(within(nav).getByText('estado da sincronização')).toBeInTheDocument()
    // No bottom bar height: nothing sits above a bar that is not there.
    expect(document.documentElement.style.getPropertyValue('--bottom-nav-height')).toBe('')
  })

  it('navigates and marks only the current item', async () => {
    stubDesktop()
    const user = userEvent.setup()
    const router = setup()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    for (const [name, path] of [['Hoje', '/hoje'], ['Configurações', '/configuracoes'], ['Treino', '/treino']] as const) {
      await user.click(within(nav).getByRole('link', { name }))
      expect(router.state.location.pathname).toBe(path)
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      expect(within(nav).getByRole('link', { name }).className).toContain('text-accent')
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    }
  })

  it('"Hoje" stays current on the check-in, and "Sair" logs out', async () => {
    stubDesktop()
    const user = userEvent.setup()
    setup('/checkin/manha')
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(nav).getByRole('link', { name: 'Hoje' })).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    await user.click(within(nav).getByRole('button', { name: 'Sair' }))
    expect(logout).toHaveBeenCalled()
  })
})
