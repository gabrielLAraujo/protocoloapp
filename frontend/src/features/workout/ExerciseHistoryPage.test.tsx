import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { setupApp } from '../testSupport'
import { ExerciseHistoryPage } from './ExerciseHistoryPage'
import { BENCH, seedExercises, seedHevySession, seedPastSession, seedPlan } from './testData'

const HEVY = '7d1f2a10-0000-5000-8000-00000000f001'

async function open(seed: (db: Awaited<ReturnType<typeof setupApp>>['db']) => Promise<unknown>) {
  const app = await setupApp([`/treino/exercicio/${BENCH}`])
  await seedExercises(app.db)
  await seedPlan(app.db, ['a', 'b'])
  await seed(app.db)
  app.view(
    <Routes>
      <Route path="/treino/exercicio/:id" element={<ExerciseHistoryPage />} />
    </Routes>,
  )
  return app
}

describe('ExerciseHistoryPage', () => {
  it('shows one row per session with the sets and the best e1RM, plus the chart', async () => {
    await open(async (db) => {
      await seedPastSession(db, '2026-10-04', BENCH, [[70, 12]])
      await seedPastSession(db, '2026-10-11', BENCH, [
        [80, 10],
        [80, 9],
      ])
    })
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

  it("lists a Hevy set's RPE", async () => {
    await open((db) => seedHevySession(db, HEVY, '2026-10-12', BENCH, [[82.5, 8, 8.5], [82.5, 7]]))
    const table = await screen.findByRole('table', { name: 'Sessões' })
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('82,5 × 8 (RPE 8,5) · 82,5 × 7')
  })
})
