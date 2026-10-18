import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPage } from './DiagnosticsPage'
import * as storageCheck from '../../data/storageCheck'
import { camera } from '../../platform/camera'
import { notifications } from '../../platform/notifications'

vi.mock('../../platform/appInfo', () => ({ getAppVersion: () => Promise.resolve('0.1.7 (7)') }))

function open() {
  return render(
    <MemoryRouter>
      <DiagnosticsPage />
    </MemoryRouter>,
  )
}

describe('DiagnosticsPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows the app version', async () => {
    open()
    expect(await screen.findByText('0.1.7 (7)')).toBeInTheDocument()
  })

  it('sends a test notification once the permission is granted', async () => {
    const send = vi.spyOn(notifications, 'sendTest').mockResolvedValue()
    vi.spyOn(notifications, 'ensurePermission').mockResolvedValue('granted')
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Testar notificação' }))

    expect(await screen.findByText(/Notificação enviada/)).toBeInTheDocument()
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not send when the notification permission is denied', async () => {
    const send = vi.spyOn(notifications, 'sendTest').mockResolvedValue()
    vi.spyOn(notifications, 'ensurePermission').mockResolvedValue('denied')
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Testar notificação' }))

    expect(await screen.findByText(/Permissão de notificações negada/)).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('reports the camera permission', async () => {
    vi.spyOn(camera, 'ensurePermission').mockResolvedValue('denied')
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Permissão da câmera' }))

    expect(await screen.findByText(/Permissão da câmera negada/)).toBeInTheDocument()
  })

  it('reports a working storage', async () => {
    vi.spyOn(storageCheck, 'runStorageCheck').mockResolvedValue()
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Testar armazenamento' }))

    expect(await screen.findByText(/Armazenamento OK/)).toBeInTheDocument()
  })

  it('says which storage step failed', async () => {
    vi.spyOn(storageCheck, 'runStorageCheck').mockRejectedValue(new storageCheck.StorageCheckError('upload'))
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Testar armazenamento' }))

    expect(await screen.findByText(/envio ao bucket falhou/)).toBeInTheDocument()
  })
})
