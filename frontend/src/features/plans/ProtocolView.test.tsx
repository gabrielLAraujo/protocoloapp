import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { planVersionSync } from '../../data/planRepo'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { ACTIVE_ID, protocolDocument } from './fixtures'
import { ProtocolView } from './ProtocolView'

describe('ProtocolView', () => {
  it('shows the active protocol read-only from the device', async () => {
    mockFetch({})
    const { db, view } = await setupApp()
    await planVersionSync.applyRemote(db, {
      entity: 'plan_version',
      id: ACTIVE_ID,
      version: 1,
      payload: { kind: 'protocol', status: 'active', document: protocolDocument(), activated_at: '2026-10-10T15:00:00.000Z', low_confidence: [] },
      deletedAt: null,
      clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
    })
    view(<ProtocolView />)

    expect(await screen.findByRole('heading', { name: 'Fase 2' })).toBeInTheDocument()
    expect(screen.getByText(/Atualização em 20\/11/)).toBeInTheDocument()
    expect(screen.getByText('Café da manhã')).toBeInTheDocument()
    expect(screen.getByText('Ovos — 120 g')).toBeInTheDocument()
    expect(screen.getByText(/Creatina/)).toBeInTheDocument()
    expect(screen.getByText('Suplemento · Qualquer horário · Todos os dias')).toBeInTheDocument()
    expect(screen.getByText('3x por semana · 30 min')).toBeInTheDocument()
    expect(screen.getByText('Água: no mínimo 3 L por dia')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('without an active protocol points to Planejamento', async () => {
    mockFetch({})
    const { view } = await setupApp()
    view(<ProtocolView />)

    expect(await screen.findByText('Nenhum protocolo ativo. Envie o PDF em Planejamento.')).toBeInTheDocument()
  })
})
