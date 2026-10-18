import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as updateCheck from '../data/updateCheck'
import { UpdateBanner } from './UpdateBanner'

const release = { version: '0.1.13', apkUrl: 'https://protocolo.example.test/api/app/apk' }

beforeEach(() => {
  vi.spyOn(updateCheck, 'checkForUpdate').mockResolvedValue(null)
})

describe('UpdateBanner', () => {
  it('shows nothing when there is no newer version', async () => {
    render(<UpdateBanner />)

    await waitFor(() => expect(updateCheck.checkForUpdate).toHaveBeenCalled())
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument()
  })

  it('offers the download when a newer version exists', async () => {
    vi.spyOn(updateCheck, 'checkForUpdate').mockResolvedValue(release)
    const download = vi.spyOn(updateCheck, 'downloadApk').mockResolvedValue()
    render(<UpdateBanner />)

    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Baixar atualização' }))

    expect(download).toHaveBeenCalledWith(release)
  })

  it('says so when the download fails', async () => {
    vi.spyOn(updateCheck, 'checkForUpdate').mockResolvedValue(release)
    vi.spyOn(updateCheck, 'downloadApk').mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<UpdateBanner />)

    await userEvent.click(await screen.findByRole('button', { name: 'Baixar atualização' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível baixar')
  })
})
