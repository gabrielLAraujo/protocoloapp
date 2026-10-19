import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/authContext'
import { BottomNav } from './BottomNav'

const logout = vi.fn().mockResolvedValue(undefined)

function setup(entry = '/') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Outlet />
            <BottomNav />
          </>
        ),
        children: ['/', '/hoje', '/treino', '/checkin', '/planejamento', '/configuracoes'].map((path) => ({ path, element: <p>{`tela ${path}`}</p> })),
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

  it('"Hoje" is highlighted on the check-in it opens', () => {
    setup('/checkin')
    expect(screen.getByRole('link', { name: 'Hoje' }).className).toContain('text-accent')
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
    const diag = screen.getByRole('link', { name: 'Configurações' })
    const exit = screen.getByRole('button', { name: 'Sair' })
    expect(diag).toHaveFocus()

    await user.tab()
    expect(exit).toHaveFocus()
    await user.tab()
    expect(diag).toHaveFocus()
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
})
