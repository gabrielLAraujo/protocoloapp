import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json, mockFetch } from '../../test/fetch-mock'
import { SyncContext, type Sync } from '../sync/syncContext'
import { CycleDatesForm } from './CycleDatesForm'
import { PLAN_ID } from './fixtures'

const withSync = (syncNow: () => Promise<void>) => ({ online: true, syncNow }) as unknown as Sync

describe('CycleDatesForm', () => {
  it('says the dates were saved even when the sync that follows fails', async () => {
    mockFetch({ [`PATCH /api/plans/${PLAN_ID}/cycle-dates`]: () => json({ id: PLAN_ID }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <SyncContext value={withSync(() => Promise.reject(new Error('sync down')))}>
        <CycleDatesForm planId={PLAN_ID} updateDate="2026-11-20" billingDate={null} onSaved={onSaved} />
      </SyncContext>,
    )

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Datas salvas')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('a failing PATCH (no connection) shows the offline message and not "Datas salvas"', async () => {
    mockFetch({}) // every request fails like a dropped connection
    const user = userEvent.setup()
    render(
      <SyncContext value={withSync(() => Promise.resolve())}>
        <CycleDatesForm planId={PLAN_ID} updateDate="2026-11-20" billingDate={null} />
      </SyncContext>,
    )
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Conecte-se à internet para salvar')
    expect(screen.queryByText('Datas salvas')).not.toBeInTheDocument()
  })
})
