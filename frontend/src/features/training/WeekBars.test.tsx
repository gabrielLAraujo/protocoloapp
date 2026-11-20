import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WeekBars } from './WeekBars'

describe('WeekBars', () => {
  it('a first week that starts mid-week shows the period start, not the Monday before', () => {
    render(
      <WeekBars
        weeks={[
          { weekStart: '2026-10-19', from: '2026-10-21', done: 1, planned: 2 },
          { weekStart: '2026-10-26', from: '2026-10-26', done: 0, planned: 3 },
        ]}
      />,
    )

    const [first, second] = within(screen.getByRole('list', { name: 'Treinos por semana' })).getAllByRole('listitem')
    expect(within(first!).getByText('Semana de 21/10: 1 de 2')).toBeInTheDocument()
    expect(first).toHaveTextContent('21/10')
    expect(first).not.toHaveTextContent('19/10')
    expect(within(second!).getByText('Semana de 26/10: 0 de 3')).toBeInTheDocument()
  })
})
