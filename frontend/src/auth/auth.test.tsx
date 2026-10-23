import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it, vi } from 'vitest'
import { photoQueue } from '../features/update/photos/photoQueue'
import { routes } from '../routes'
import { json, mockFetch, problem, tokenResponse } from '../test/fetch-mock'
import { useAuth } from './authContext'
import { AuthProvider } from './AuthProvider'
import { tokenStore } from './tokenStore'

function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}

describe('login', () => {
  it('login page submits and redirects', async () => {
    const calls = mockFetch({
      'POST /api/auth/login': () => json(tokenResponse()),
      'GET /api/auth/me': () => json({ id: 'x', email: 'atleta@example.com' }),
    })
    const user = userEvent.setup()
    const router = renderApp('/')

    // Signed out: the protected route sends to the login page.
    await user.type(await screen.findByLabelText('E-mail'), 'atleta@example.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo-de-teste')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(JSON.parse(calls.find((call) => call.path === '/api/auth/login')!.body)).toEqual({
      email: 'atleta@example.com',
      password: 'segredo-de-teste',
    })
    expect(tokenStore.getAccessToken()).toBe('access-1')
    expect(await tokenStore.getRefreshToken()).toBe('refresh-1')
  })

  it('shows an error on wrong credentials', async () => {
    mockFetch({ 'POST /api/auth/login': () => problem(401, { title: 'Unauthorized' }) })
    const user = userEvent.setup()
    const router = renderApp('/login')

    await user.type(await screen.findByLabelText('E-mail'), 'atleta@example.com')
    await user.type(screen.getByLabelText('Senha'), 'errada')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos')
    expect(router.state.location.pathname).toBe('/login')
  })

  it('restores the session from the stored refresh token', async () => {
    await tokenStore.setTokens(tokenResponse('stored'))
    mockFetch({
      'GET /api/auth/me': (call) =>
        call.headers.get('Authorization') === 'Bearer access-fresh'
          ? json({ id: 'x', email: 'atleta@example.com' })
          : problem(401),
      'POST /api/auth/refresh': () => json(tokenResponse('fresh')),
    })

    renderApp('/')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
  })

  it('stays signed in when /me fails with a server error at startup', async () => {
    await tokenStore.setTokens(tokenResponse('stored'))
    mockFetch({ 'GET /api/auth/me': () => problem(503) })

    renderApp('/')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(await tokenStore.getRefreshToken()).toBe('refresh-stored')
  })

  it('signs out when the stored session is rejected for good', async () => {
    await tokenStore.setTokens(tokenResponse('stored'))
    mockFetch({
      'GET /api/auth/me': () => problem(401),
      'POST /api/auth/refresh': () => problem(401),
    })

    const router = renderApp('/')

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('logout', () => {
  it('drops the update photos still waiting to be sent', async () => {
    await tokenStore.setTokens(tokenResponse('stored'))
    mockFetch({ 'GET /api/auth/me': () => json({ id: 'x', email: 'atleta@example.com' }), 'POST /api/auth/logout': () => new Response(null, { status: 204 }) })
    const clear = vi.spyOn(photoQueue, 'clear').mockResolvedValue()
    function SignOut() {
      const { status, logout } = useAuth()
      return (
        <button type="button" onClick={() => void logout()}>
          {status}
        </button>
      )
    }
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <SignOut />
      </AuthProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'signedIn' }))

    expect(await screen.findByRole('button', { name: 'signedOut' })).toBeInTheDocument()
    expect(clear).toHaveBeenCalledTimes(1)
    clear.mockRestore()
  })
})
