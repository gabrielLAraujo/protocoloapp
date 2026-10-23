import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as push from '../../pwa/push'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { SettingsPage } from './SettingsPage'

async function open(support: push.PushSupport, subscribed = false) {
  mockFetch({})
  vi.spyOn(push, 'pushSupport').mockReturnValue(support)
  vi.spyOn(push, 'currentSubscription').mockResolvedValue(subscribed ? ({ endpoint: 'https://push.example.test/x' } as PushSubscription) : null)
  const refresh = vi.spyOn(push, 'refreshSubscription').mockResolvedValue()
  const app = await setupApp()
  app.view(<SettingsPage />)
  return { ...app, refresh }
}

describe('SettingsPage', () => {
  it('links to Horários, Questionário de atualização and Diagnóstico', async () => {
    await open('default')

    expect(screen.getByRole('heading', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Horários/ })).toHaveAttribute('href', '/configuracoes/horarios')
    expect(screen.getByRole('link', { name: /Questionário de atualização/ })).toHaveAttribute('href', '/configuracoes/questionario')
    expect(screen.getByRole('link', { name: /Diagnóstico/ })).toHaveAttribute('href', '/settings/diagnostics')
  })

  it('asks to install on iOS Safari outside the Home Screen app', async () => {
    await open('needs-install')

    expect(screen.getByText('Instale na Tela de Início para ativar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ativar lembretes' })).not.toBeInTheDocument()
  })

  it('explains where to allow the notifications when denied', async () => {
    await open('denied')

    expect(screen.getByText('Permissão negada nos Ajustes do iPhone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ativar lembretes' })).not.toBeInTheDocument()
  })

  it('says so on a device without push', async () => {
    await open('unsupported')

    expect(screen.getByText(/não recebe lembretes/)).toBeInTheDocument()
  })

  it('"Ativar lembretes" turns them on with the device data, then offers the test', async () => {
    const support = vi.fn<() => push.PushSupport>(() => 'default')
    const { db } = await open('default')
    vi.mocked(push.pushSupport).mockImplementation(() => support())
    const enable = vi.spyOn(push, 'enableReminders').mockImplementation(() => {
      support.mockReturnValue('granted')
      vi.mocked(push.currentSubscription).mockResolvedValue({ endpoint: 'https://push.example.test/x' } as PushSubscription)
      return Promise.resolve('enabled')
    })
    const test = vi.spyOn(push, 'sendTest').mockResolvedValue({ sent: 2, removed: 0 })

    await userEvent.click(screen.getByRole('button', { name: 'Ativar lembretes' }))

    expect(await screen.findByText('Lembretes ativados')).toBeInTheDocument()
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ db, userId: expect.any(String), syncNow: expect.any(Function) }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar teste' }))
    expect(await screen.findByText('Enviado para 2 aparelhos.')).toBeInTheDocument()
    expect(test).toHaveBeenCalledTimes(1)
  })

  it('shows the denied state when the prompt is refused', async () => {
    const support = vi.fn<() => push.PushSupport>(() => 'default')
    await open('default')
    vi.mocked(push.pushSupport).mockImplementation(() => support())
    vi.spyOn(push, 'enableReminders').mockImplementation(() => {
      support.mockReturnValue('denied')
      return Promise.resolve('denied')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Ativar lembretes' }))

    expect(await screen.findByText('Permissão negada nos Ajustes do iPhone')).toBeInTheDocument()
  })

  it('shows the reason when enabling fails', async () => {
    await open('default')
    vi.spyOn(push, 'enableReminders').mockRejectedValue(new push.ReminderError('O servidor recusou a inscrição deste aparelho.'))

    await userEvent.click(screen.getByRole('button', { name: 'Ativar lembretes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O servidor recusou a inscrição deste aparelho.')
  })

  it('"Desativar" turns them off', async () => {
    await open('granted', true)
    const disable = vi.spyOn(push, 'disableReminders').mockResolvedValue()

    await userEvent.click(await screen.findByRole('button', { name: 'Desativar' }))

    expect(disable).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Ativar lembretes' })).toBeInTheDocument()
  })

  it('says the test failed', async () => {
    await open('granted', true)
    vi.spyOn(push, 'sendTest').mockRejectedValue(new push.ReminderError('O servidor não enviou o teste. Tente de novo.'))

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar teste' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('O servidor não enviou o teste.')
  })

  it('sends the existing subscription to the server again on open', async () => {
    const { refresh } = await open('granted', true)

    expect(await screen.findByText('Lembretes ativados')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledWith({ endpoint: 'https://push.example.test/x' })
  })

  it('offers "Ativar lembretes" again when the test reached no device', async () => {
    await open('granted', true)
    vi.spyOn(push, 'sendTest').mockResolvedValue({ sent: 0, removed: 0 })

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar teste' }))

    expect(await screen.findByText(/Nenhum aparelho recebeu/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar lembretes' })).toBeInTheDocument()
  })

  it('reads the permission again when the app comes back to the foreground', async () => {
    await open('default')
    expect(screen.getByRole('button', { name: 'Ativar lembretes' })).toBeInTheDocument()

    vi.mocked(push.pushSupport).mockReturnValue('denied')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByText('Permissão negada nos Ajustes do iPhone')).toBeInTheDocument()
  })
})
