import { render, screen } from '@testing-library/react'
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
        children: ['/', '/treino', '/checkin', '/planejamento', '/settings/diagnostics'].map((path) => ({ path, element: <p>{`tela ${path}`}</p> })),
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

    for (const [name, path] of [['Treino', '/treino'], ['Check-in', '/checkin'], ['Planejamento', '/planejamento'], ['Resumo', '/']] as const) {
      await user.click(screen.getByRole('link', { name }))
      expect(router.state.location.pathname).toBe(path)
      expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    }
  })

  it('"Resumo" is not current on other routes', () => {
    setup('/treino')
    expect(screen.getByRole('link', { name: 'Resumo' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Treino' })).toHaveAttribute('aria-current', 'page')
  })

  it('"Mais" opens Diagnóstico and Sair', async () => {
    const user = userEvent.setup()
    const router = setup()
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mais' }))
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(logout).toHaveBeenCalled()

    await user.click(screen.getByRole('link', { name: 'Diagnóstico' }))
    expect(router.state.location.pathname).toBe('/settings/diagnostics')
    expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
  })

  it('publishes its height as --bottom-nav-height', () => {
    setup()
    expect(document.documentElement.style.getPropertyValue('--bottom-nav-height')).toMatch(/px$/)
  })
})
