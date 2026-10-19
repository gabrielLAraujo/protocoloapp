import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { setupApp } from '../testSupport'
import { ExerciseHistoryPage } from './ExerciseHistoryPage'
import { HistoryPage } from './HistoryPage'
import { BENCH, seedExercises, seedPastSession, seedPlan } from './testData'

async function seeded(entry: string) {
  const app = await setupApp([entry])
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  await seedPastSession(app.db, '2026-10-04', BENCH, [[70, 12]])
  await seedPastSession(app.db, '2026-10-11', BENCH, [
    [80, 10],
    [80, 9],
  ])
  app.view(
    <Routes>
      <Route path="/treino/historico" element={<HistoryPage />} />
      <Route path="/treino/exercicio/:id" element={<ExerciseHistoryPage />} />
    </Routes>,
  )
  return app
}

describe('HistoryPage', () => {
  it('lists sessions newest first with date, day and volume, and links to the exercise', async () => {
    await seeded('/treino/historico')
    const list = await screen.findByRole('region', { name: 'Sessões' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('11/10/2026')
    expect(items[0]).toHaveTextContent('Treino A')
    expect(items[0]).toHaveTextContent('1.520 kg')
    expect(items[1]).toHaveTextContent('04/10/2026')
    expect(items[1]).toHaveTextContent('840 kg')

    const link = screen.getByRole('link', { name: /Supino reto/ })
    expect(link).toHaveAttribute('href', `/treino/exercicio/${BENCH}`)
    await userEvent.setup().click(link)
    expect(await screen.findByRole('heading', { name: 'Supino reto' })).toBeInTheDocument()
  })

  it('shows an empty message without sessions', async () => {
    const app = await setupApp(['/treino/historico'])
    app.view(<HistoryPage />)
    expect(await screen.findByText('Nenhum treino registrado ainda.')).toBeInTheDocument()
  })
})

describe('ExerciseHistoryPage', () => {
  it('shows one row per session with the sets and the best e1RM, plus the chart', async () => {
    await seeded(`/treino/exercicio/${BENCH}`)
    expect(await screen.findByRole('heading', { name: 'Supino reto' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /1RM estimado por sessão/ })).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Sessões' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('11/10/2026')
    expect(rows[0]).toHaveTextContent('80 × 10 · 80 × 9')
    expect(rows[0]).toHaveTextContent('106,7 kg')
    expect(rows[1]).toHaveTextContent('04/10/2026')
    expect(rows[1]).toHaveTextContent('98 kg')
  })
})
